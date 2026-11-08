import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { buildBirdGeometry, buildWindGeometry, migrationVertexStride } from '../data/migrationGeometry';
import { migrationRoutes, type MigrationRoute } from '../data/mapFrames';
import { orientSeasonalRoutes, type SeasonalMigrationDirection } from '../data/seasonalMigration';

interface MeshBuffer { buffer: WebGLBuffer; vertexArray: WebGLVertexArrayObject; vertexCount: number }
interface ShaderProgram { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }

export class MigrationLayer implements CustomLayerInterface {
  readonly id = 'migration-flight';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map: MapLibreMap | null = null;
  private windBuffer: MeshBuffer | null = null;
  private birdBuffer: MeshBuffer | null = null;
  private programs = new Map<string, ShaderProgram>();
  private elapsedSeconds = 0;
  private visible = true;
  private windRadiusMeters = 0;
  private baseRoutes: readonly MigrationRoute[] = migrationRoutes;
  private seasonalDirection: SeasonalMigrationDirection = null;
  private routes: readonly MigrationRoute[] = [];

  setRegionRoute(route: MigrationRoute | null, regionalFocus: boolean) {
    this.baseRoutes = regionalFocus ? (route ? [route] : []) : migrationRoutes;
    this.routes = orientSeasonalRoutes(this.baseRoutes, this.seasonalDirection);
    this.windRadiusMeters = 0;
    this.map?.triggerRepaint();
  }

  setSeasonalDirection(direction: SeasonalMigrationDirection) {
    this.seasonalDirection = direction;
    this.routes = orientSeasonalRoutes(this.baseRoutes, direction);
    this.windRadiusMeters = 0;
    this.map?.triggerRepaint();
  }

  setFrame(elapsedSeconds: number) {
    this.elapsedSeconds = elapsedSeconds;
    this.map?.triggerRepaint();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.windBuffer = createMeshBuffer(gl);
    this.birdBuffer = createMeshBuffer(gl);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.visible || !this.map || !this.windBuffer || !this.birdBuffer) return;
    const shader = this.getShader(gl, options);
    const projection = options.getProjectionData({ tileID: { canonical: { x: 0, y: 0, z: 0 } }, applyGlobeMatrix: true });
    gl.useProgram(shader.program);
    gl.uniformMatrix4fv(shader.uniforms.u_projection_matrix, false, new Float32Array(projection.mainMatrix));
    gl.uniformMatrix4fv(shader.uniforms.u_projection_fallback_matrix, false, new Float32Array(projection.fallbackMatrix));
    gl.uniform4fv(shader.uniforms.u_projection_tile_mercator_coords, projection.tileMercatorCoords);
    gl.uniform4fv(shader.uniforms.u_projection_clipping_plane, projection.clippingPlane);
    gl.uniform1f(shader.uniforms.u_projection_transition, projection.projectionTransition);
    gl.uniform1f(shader.uniforms.u_time, this.elapsedSeconds);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const modelScaleMeters = Math.max(80, Math.min(36000, 12000 * 2 ** (3.5 - this.map.getZoom())));
    const windRadiusMeters = Math.max(30, 2 ** (Math.round(Math.log2(modelScaleMeters * 0.55) * 4) / 4));
    if (windRadiusMeters !== this.windRadiusMeters) {
      uploadMesh(gl, this.windBuffer, buildWindGeometry(windRadiusMeters, this.routes), gl.STATIC_DRAW);
      this.windRadiusMeters = windRadiusMeters;
    }
    gl.depthMask(false);
    gl.bindVertexArray(this.windBuffer.vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, this.windBuffer.vertexCount);

    uploadMesh(gl, this.birdBuffer, buildBirdGeometry(this.elapsedSeconds, modelScaleMeters * 0.35, this.routes), gl.DYNAMIC_DRAW);
    gl.depthMask(true);
    gl.bindVertexArray(this.birdBuffer.vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, this.birdBuffer.vertexCount);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    for (const mesh of [this.windBuffer, this.birdBuffer]) {
      if (!mesh) continue;
      gl.deleteBuffer(mesh.buffer);
      gl.deleteVertexArray(mesh.vertexArray);
    }
    for (const shader of this.programs.values()) gl.deleteProgram(shader.program);
    this.programs.clear();
    this.windBuffer = null;
    this.birdBuffer = null;
    this.map = null;
    this.windRadiusMeters = 0;
  }

  private getShader(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): ShaderProgram {
    const cached = this.programs.get(options.shaderData.variantName);
    if (cached) return cached;
    const vertexSource = `#version 300 es
      precision highp float;
      ${options.shaderData.vertexShaderPrelude}
      ${options.shaderData.define}
      layout(location = 0) in vec3 a_position;
      layout(location = 1) in vec4 a_color;
      layout(location = 2) in float a_progress;
      out vec4 v_color;
      out float v_progress;
      out float v_horizon;
      void main() {
        vec2 tilePosition = a_position.xy * 8192.0;
        v_horizon = 1.0;
        #ifdef GLOBE
          v_horizon = mix(1.0, dot(projectToSphere(tilePosition), u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w, u_projection_transition);
        #endif
        gl_Position = projectTileFor3D(tilePosition, a_position.z);
        v_color = a_color;
        v_progress = a_progress;
      }`;
    const fragmentSource = `#version 300 es
      precision highp float;
      uniform float u_time;
      in vec4 v_color;
      in float v_progress;
      in float v_horizon;
      out vec4 fragmentColor;
      void main() {
        if (v_horizon < 0.0) discard;
        float alpha = v_color.a;
        if (v_progress >= 0.0) {
          float flow = fract(v_progress - u_time * 0.035);
          float pulse = exp(-pow((flow - 0.5) / 0.12, 2.0));
          alpha *= (0.4 + 0.6 * pulse) * smoothstep(0.0, 0.06, v_progress) * smoothstep(0.0, 0.06, 1.0 - v_progress);
        }
        fragmentColor = vec4(v_color.rgb * alpha, alpha);
      }`;
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate the migration shader program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Unable to link the migration shader: ${message}`);
    }
    const uniforms = Object.fromEntries(['u_projection_matrix', 'u_projection_fallback_matrix', 'u_projection_tile_mercator_coords',
      'u_projection_clipping_plane', 'u_projection_transition', 'u_time'].map((name) => [name, gl.getUniformLocation(program, name)]));
    const shader = { program, uniforms };
    this.programs.set(options.shaderData.variantName, shader);
    return shader;
  }
}

function createMeshBuffer(gl: WebGL2RenderingContext): MeshBuffer {
  const buffer = gl.createBuffer();
  const vertexArray = gl.createVertexArray();
  if (!buffer || !vertexArray) throw new Error('Unable to allocate migration geometry buffers.');
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [location, size, offset] of [[0, 3, 0], [1, 4, 3], [2, 1, 7]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, migrationVertexStride * 4, offset * 4);
  }
  gl.bindVertexArray(null);
  return { buffer, vertexArray, vertexCount: 0 };
}

function uploadMesh(gl: WebGL2RenderingContext, mesh: MeshBuffer, vertices: Float32Array, usage: number) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, usage);
  mesh.vertexCount = vertices.length / migrationVertexStride;
}

function compileShader(gl: WebGL2RenderingContext, shaderType: number, source: string): WebGLShader {
  const shader = gl.createShader(shaderType);
  if (!shader) throw new Error('Unable to allocate the migration shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Unable to compile the migration shader: ${message}`);
  }
  return shader;
}

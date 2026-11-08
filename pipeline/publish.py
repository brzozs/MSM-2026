"""Copy only the public atlas files; never expose collection caches or credentials."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath


def publish_public_assets(manifest_path, destination_directory, secret_values=()):
    manifest_path = Path(manifest_path)
    destination_directory = Path(destination_directory)
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get('schema_version') != 1 or manifest.get('kind') != 'ecology-atlas':
        raise ValueError('Expected a national ecology atlas manifest.')
    references = [manifest['overview_url'], *(state['snapshot_url'] for state in manifest['states'])]
    public_files = {}
    generation_names = set()
    for reference in references:
        if not isinstance(reference, str) or not re.fullmatch(r'generation-[A-Za-z0-9]+/[A-Za-z0-9-]+\.json', reference):
            raise ValueError('Public references must name JSON files in a generation directory.')
        relative_path = PurePosixPath(reference)
        generation_names.add(relative_path.parts[0])
        source_path = (manifest_path.parent / relative_path).resolve()
        if not source_path.is_relative_to(manifest_path.parent.resolve()):
            raise ValueError('Public reference escapes its source directory.')
        content = source_path.read_bytes()
        json.loads(content)
        public_files[reference] = content
    if len(generation_names) != 1:
        raise ValueError('Every public file must belong to one generation.')
    for content in [manifest_bytes, *public_files.values()]:
        if any(secret and secret.encode() in content for secret in secret_values):
            raise ValueError('Credential detected; public assets were not replaced.')
    destination_directory.mkdir(parents=True, exist_ok=True)
    generation_name = next(iter(generation_names))
    generation_destination = destination_directory / generation_name
    with tempfile.TemporaryDirectory(prefix='.publish-', dir=destination_directory) as temporary_directory:
        staging_directory = Path(temporary_directory)
        for relative_path, content in public_files.items():
            staged_file = staging_directory / relative_path
            staged_file.parent.mkdir(parents=True, exist_ok=True)
            staged_file.write_bytes(content)
        if generation_destination.exists():
            if any((destination_directory / relative_path).read_bytes() != content for relative_path, content in public_files.items()):
                raise ValueError('An existing immutable public generation has different contents.')
        else:
            os.replace(staging_directory / generation_name, generation_destination)
        staged_manifest = staging_directory / 'latest.json'
        staged_manifest.write_bytes(manifest_bytes)
        os.replace(staged_manifest, destination_directory / 'latest.json')
    return len(public_files)


def main():
    repository_directory = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=repository_directory / 'pipeline/output/latest.json')
    parser.add_argument('--destination', type=Path, default=repository_directory / 'web/public/data/ecology')
    options = parser.parse_args()
    from pipeline.sources import load_ebird_api_key
    api_key = load_ebird_api_key(repository_directory / 'pipeline/.env.local')
    try:
        count = publish_public_assets(options.source, options.destination, secret_values=(api_key,))
    except (ValueError, KeyError, TypeError, OSError):
        parser.exit(1, 'Public data publication failed; previous manifest preserved. Verify the collected atlas files.\n')
    print(f'Published {count} public generation files and latest.json. Collection caches excluded.')


if __name__ == '__main__':
    main()

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.publish import publish_public_assets


class PublicAssetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / 'private'
        self.destination = Path(self.temporary.name) / 'public'
        self.source.mkdir()
        generation = self.source / 'generation-example'
        generation.mkdir()
        (generation / 'overview.json').write_text('{"public":true}')
        (generation / 'US-NY.json').write_text('{"public":true}')
        (self.source / 'weather-cache').mkdir()
        (self.source / 'weather-cache' / 'private.json').write_text('{"cache":true}')
        self.manifest = {'schema_version': 1, 'kind': 'ecology-atlas', 'overview_url': 'generation-example/overview.json',
                         'states': [{'snapshot_url': 'generation-example/US-NY.json'}]}
        (self.source / 'latest.json').write_text(json.dumps(self.manifest))

    def test_publishes_only_referenced_files_and_manifest(self):
        publish_public_assets(self.source / 'latest.json', self.destination)
        self.assertEqual(json.loads((self.destination / 'latest.json').read_text()), self.manifest)
        self.assertTrue((self.destination / 'generation-example' / 'US-NY.json').exists())
        self.assertFalse((self.destination / 'weather-cache').exists())

    def test_missing_state_preserves_previous_publication(self):
        self.destination.mkdir()
        (self.destination / 'latest.json').write_text('previous generation')
        (self.source / 'generation-example' / 'US-NY.json').unlink()
        with self.assertRaises((ValueError, OSError)):
            publish_public_assets(self.source / 'latest.json', self.destination)
        self.assertEqual((self.destination / 'latest.json').read_text(), 'previous generation')

    def test_path_traversal_and_cache_references_are_rejected(self):
        for invalid_url in ['../private.json', '/etc/passwd', 'weather-cache/private.json', 'https://example.test/data.json']:
            with self.subTest(url=invalid_url):
                self.manifest['overview_url'] = invalid_url
                (self.source / 'latest.json').write_text(json.dumps(self.manifest))
                with self.assertRaises(ValueError):
                    publish_public_assets(self.source / 'latest.json', self.destination)

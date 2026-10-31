import unittest
from unittest.mock import patch

from external.xiangqi_explorer import player_catalog


class PlayerDisplayNameTest(unittest.TestCase):
    def test_romanization_preserves_source_names_and_identity(self):
        original = {'id': 'player:c3e406d747d9cce508c15937', 'name': '崔岩', 'aliases': ['崔岩']}
        result = player_catalog.display_profile(original)
        self.assertEqual(result['displayName'], 'Cui Yan (崔岩)')
        self.assertEqual(result['name'], '崔岩')
        self.assertEqual(result['id'], original['id'])
        self.assertNotIn('displayName', original)
        self.assertEqual(result['aliases'], ['崔岩'])

    def test_published_latin_name_is_not_replaced(self):
        self.assertEqual(player_catalog.display_profile({'name': 'Hsu Yin Chuan'})['displayName'], 'Hsu Yin Chuan')
        self.assertIsNone(player_catalog.display_profile(None))

    def test_list_get_and_batch_use_the_same_display_name(self):
        profile = {'id': 'player:123', 'name': '崔岩'}
        class Connection:
            def close(self):
                pass
        with patch.object(player_catalog, 'open_catalog_connection', return_value=Connection()), \
             patch.object(player_catalog.players, 'find', return_value=profile), \
             patch.object(player_catalog.players, 'query', return_value={'players': [profile]}):
            values = [player_catalog.read({'action': 'get', 'id': 'player:123'})['player'],
                      player_catalog.read({'action': 'batch', 'ids': ['player:123']})['players'][0],
                      player_catalog.read({'action': 'list'})['players'][0]]
        self.assertTrue(all(p['displayName'] == 'Cui Yan (崔岩)' for p in values))

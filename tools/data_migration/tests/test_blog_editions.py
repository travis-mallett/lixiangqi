"""Blog edition migration against isolated MongoDB 8.2; no production databases."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import uuid

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'tools/data_migration/20261108_blog_editions_v1.js'
RESTORE = ROOT / 'tools/data_migration/20261108_blog_editions_restore.js'
MONGOSH = os.environ.get('LIXIANGQI_MONGOSH') or shutil.which('mongosh')


@unittest.skipUnless(os.environ.get('LIXIANGQI_MIGRATION_TEST_URI') and MONGOSH,
                     'isolated MongoDB URI and mongosh required')
class BlogEditionTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ['LIXIANGQI_MIGRATION_TEST_URI'])
        self.db = self.client['blog_editions_test_' + uuid.uuid4().hex]
        self.original = dict(_id='abcdefgh', title='Original', intro='Introduction',
                             markdown='Original body', language='en', official=True, live=True,
                             created=dict(by='author', at=datetime(2025, 1, 1)),
                             lived=dict(by='author', at=datetime(2025, 2, 1)),
                             likes=7, likers=['author', 'reader'], views=99, discuss=True,
                             blog='user:author', featured=dict(at=datetime(2025, 2, 1)),
                             automod=dict(quality=2), image=dict(id='cover.png', alt='A horse'))
        self.db.ublog_post.insert_one(self.original)
        revision = hashlib.sha256(json.dumps([
            'en', 'Original', 'Introduction', 'Original body', 'cover.png', 'A horse', None
        ], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        self.release = [dict(id='abcdefgh', language='vi', sourceLanguage='en', sourceRevision=revision,
                             title='Bài viết', intro='Giới thiệu', markdown='Nội dung cờ tướng',
                             imageAlt='Con ngựa', translator='AI translator', reviewer='AI review', reviewed=True)]

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def run_script(self, script=MIGRATION, success=True, extra=''):
        code = (f'db=db.getSiblingDB({json.dumps(self.db.name)});'
                f'globalThis.blogEditionRelease={json.dumps(self.release, ensure_ascii=False)};'
                f'{extra}load({json.dumps(script.as_posix())});')
        result = subprocess.run([MONGOSH, os.environ['LIXIANGQI_MIGRATION_TEST_URI'],
                                 '--quiet', '--eval', code], capture_output=True,
                                text=True, encoding='utf-8', timeout=60)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def test_preserves_identity_history_engagement_and_recoverable_original(self):
        self.db.forum_topic.insert_one(dict(_id='comments', slug='ublog-abcdefgh', posts=8))
        self.run_script()
        saved = self.db.ublog_post.find_one()
        translations = saved.pop('translations')
        saved.pop('searchCjk')
        self.assertEqual(saved, self.original)
        self.assertEqual(self.db['__blog_editions_v1_backup'].find_one()['original'], self.original)
        self.assertEqual(self.db.ublog_post.count_documents({}), 1)
        self.assertEqual(self.db.forum_topic.find_one()['posts'], 8)
        self.assertEqual(translations[0]['published']['imageAlt'], 'Con ngựa')
        self.assertGreater(translations[0]['published']['publishedAt'], self.original['lived']['at'])
        self.assertEqual(self.db.ublog_post.count_documents({'$text': {'$search': 'tướng'}}), 1)
        self.db.ublog_post.update_one({'_id': 'abcdefgh'}, {'$set': {
            'translations.0.draft': dict(title='secretword', intro='', markdown='unreleasedtoken')}})
        self.assertEqual(self.db.ublog_post.count_documents({'$text': {'$search': 'secretword unreleasedtoken'}}), 0)

    def test_resume_after_post_write_before_receipt_preserves_publication_date(self):
        self.run_script()
        before = self.db.ublog_post.find_one()
        self.db['__lixiangqi_migrations'].delete_one({'_id': 'blog-edition-v1:abcdefgh:vi'})
        self.run_script()
        self.assertEqual(self.db.ublog_post.find_one(), before)
        self.run_script()
        self.assertEqual(self.db.ublog_post.find_one(), before)

    def test_chinese_substrings_are_indexed_without_document_scans(self):
        self.release[0].update(language='zh-Hans', title='象棋与基本杀法', markdown='马炮配合')
        self.run_script()
        query = {'$text': {'$search': '"基本 本杀 杀法"', '$language': 'none'}}
        self.assertEqual(self.db.ublog_post.count_documents(query), 1)
        self.assertIn('TEXT', str(self.db.ublog_post.find(query).explain()['queryPlanner']['winningPlan']))
        self.assertEqual(self.db.ublog_post.count_documents({'$text': {'$search': '"基本 马炮"', '$language': 'none'}}), 0)

    def test_entire_release_and_schema_preflight_before_mutation(self):
        self.release.append({**self.release[0], 'id': 'missing1'})
        self.run_script(success=False)
        self.assertEqual(self.db.ublog_post.find_one(), self.original)
        self.assertEqual(self.db['__blog_editions_v1_backup'].count_documents({}), 0)
        self.release.pop()
        self.db.ublog_post.insert_one(dict(_id='malformed', title=3))
        self.run_script(success=False)
        self.assertEqual(self.db.ublog_post.find_one({'_id': 'abcdefgh'}), self.original)

    def test_rejects_stale_unreviewed_duplicate_or_existing_editions(self):
        for field, value in [('sourceRevision', 'stale'), ('reviewed', False), ('language', 'en')]:
            original = self.release[0][field]
            self.release[0][field] = value
            self.run_script(success=False)
            self.release[0][field] = original
            self.assertEqual(self.db.ublog_post.find_one(), self.original)
        self.release.append(self.release[0].copy())
        self.run_script(success=False)
        self.release.pop()
        self.db.ublog_post.update_one({}, {'$set': {'translations': [{'language': 'vi', 'draft': {'title': 'Existing'}}]}})
        self.run_script(success=False)

    def test_completed_release_does_not_overwrite_later_editorial_changes(self):
        self.run_script()
        self.db.ublog_post.update_one({}, {'$set': {'title': 'Later source', 'translations.0.published.title': 'Later translation'}})
        before = self.db.ublog_post.find_one()
        self.run_script()
        self.assertEqual(self.db.ublog_post.find_one(), before)
        self.release[0]['title'] = 'Changed release'
        self.run_script(success=False)
        self.assertEqual(self.db.ublog_post.find_one(), before)

    def test_restore_preserves_post_migration_edits_and_can_rerun(self):
        self.run_script()
        self.db.ublog_post.update_one({}, {'$set': {'title': 'Post-migration edit'}})
        before = self.db.ublog_post.find_one()
        self.run_script(RESTORE, success=False)
        self.run_script(RESTORE, extra='globalThis.blogEditionRestoreAcknowledged=true;')
        self.assertEqual(self.db.ublog_post.find_one(), self.original)
        self.assertEqual(self.db['__blog_editions_v1_restore_backup'].find_one()['original'], before)
        self.run_script()
        self.assertEqual(len(self.db.ublog_post.find_one()['translations']), 1)


if __name__ == '__main__':
    unittest.main()

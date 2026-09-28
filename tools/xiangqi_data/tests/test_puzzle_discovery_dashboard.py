import io
import sqlite3
import unittest
from tools.xiangqi_data.puzzle_mining.discovery_dashboard import DiscoveryDashboard
from tools.xiangqi_data.puzzle_mining.progress import DashboardPrinter


class DiscoveryDashboardTest(unittest.TestCase):
    def test_persistent_counts_separate_sources_and_do_not_count_retry_as_completed(self):
        connection = sqlite3.connect(':memory:')
        connection.row_factory = sqlite3.Row
        self.addCleanup(connection.close)
        connection.execute('CREATE TABLE game_jobs (source_database TEXT, status TEXT, discovery_version TEXT)')
        connection.executemany('INSERT INTO game_jobs VALUES (?, ?, ?)', [
            ('lixiangqi:https://example.test', 'complete', '2'),
            ('catalog', 'queued', '2'), ('catalog', 'processing', '2'),
            ('catalog', 'retry', '2'), ('catalog', 'failed', '2'),
            ('catalog', 'complete', 'old'),
        ])
        stream = io.StringIO()
        dashboard = DiscoveryDashboard(connection, '2', 1, printer=DashboardPrinter(stream=stream))
        dashboard.event(('started', 0, 'g:123', 'catalog'))
        dashboard.event(('detail', 0, 'g:123', 'evaluating', 2, 4))
        dashboard.render(finish=True)
        output = stream.getvalue()
        self.assertIn('Site games 1/1', output)
        self.assertIn('Local catalogs 1/4', output)
        self.assertIn('left 3 | queued 1 | active 1 | retry 1', output)
        self.assertIn('Worker 1 catalog: evaluating 2/4 | g:123', output)
        dashboard.event(('progress', 0, 'g:123', 'retry', {'stored': 0}, 'catalog'))
        self.assertEqual(dashboard.results['complete'], 0)
        self.assertFalse(dashboard.active)
        connection.execute("UPDATE game_jobs SET status='complete' WHERE status='processing'")
        dashboard.render(finish=True)
        self.assertIn('Local catalogs 2/4', stream.getvalue())
        dashboard.event(('publication', 0, 'Uploading g:123 at depth 20'))
        dashboard.event(('published', 0, 'uploaded'))
        dashboard.event(('published', 0, 'retained'))
        dashboard.render(finish=True)
        self.assertIn('Worker 1 catalog: Uploading g:123 at depth 20', stream.getvalue())
        self.assertIn('Game analyses: 1 uploaded | 1 existing analyses retained', stream.getvalue())

    def test_idle_continuous_run_reports_waiting(self):
        connection = sqlite3.connect(':memory:')
        connection.row_factory = sqlite3.Row
        self.addCleanup(connection.close)
        connection.execute('CREATE TABLE game_jobs (source_database TEXT, status TEXT, discovery_version TEXT)')
        stream = io.StringIO()
        dashboard = DiscoveryDashboard(connection, '2', 1, continuous=True, printer=DashboardPrinter(stream=stream))
        dashboard.render()
        self.assertIn('Waiting for new site games', stream.getvalue())


class DiscoveryProgressTest(unittest.TestCase):
    def test_evaluates_every_position_once(self):
        from tools.xiangqi_data.puzzle_mining.discovery import DiscoveryConfig, discover_game
        from tools.xiangqi_data.puzzle_mining.models import EngineScore, SearchLine, SearchResult
        from unittest.mock import Mock

        result = SearchResult('fake', 'fake', 'a0a1', (
            SearchLine(1, 10, 10, 100, 1, EngineScore('cp', 100, (900, 0, 100)), ('a0a1',)),
        ))
        events = []
        discover_game(Mock(), source_database='catalog', game_id='test', source_url='',
                      moves=['a4a5', 'a7a6'],
                      config=DiscoveryConfig(tactic_advantage=2),
                      analyse=lambda context, nodes: result,
                      progress=lambda *event: events.append(event))
        self.assertEqual(events, [('evaluating', 1, 3), ('evaluating', 2, 3), ('evaluating', 3, 3)])

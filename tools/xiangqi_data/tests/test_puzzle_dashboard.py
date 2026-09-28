import os
import unittest
from io import StringIO
from unittest.mock import Mock, patch

from tools.xiangqi_data.puzzle_mining.checkmate_dashboard import CheckmateDashboard
from tools.xiangqi_data.puzzle_mining.checkmate_inventory import (
    CategoryInventory, CheckmateInventory, InventoryCounts,
)
from tools.xiangqi_data.puzzle_mining.progress import DashboardPrinter
from tools.xiangqi_data.puzzle_mining.verification_dashboard import VerificationDashboard


class VerificationDashboardTest(unittest.TestCase):
    def test_attempts_distinguish_success_from_retries_and_incomplete_work(self):
        dashboard = VerificationDashboard(None, 'test', workers=2, queued=100,
                                          continuous=False, poll_interval=5)
        dashboard.printer = Mock()
        for status in ('retry', 'retry', 'failed', 'incomplete', 'complete', 'invalid'):
            dashboard.record(status)
        dashboard.render('Verifying')
        text = dashboard.printer.update.call_args.args[0]
        self.assertIn('6 attempts finished', text)
        self.assertIn('1 verified', text)
        self.assertIn('1 incomplete', text)
        self.assertIn('2 retries', text)
        self.assertIn('1 failed', text)


class DashboardTest(unittest.TestCase):
    def test_redirected_output_is_sparse_and_has_no_escape_sequences(self):
        stream = StringIO()
        printer = DashboardPrinter(stream=stream)
        with patch('time.monotonic', side_effect=[0, 5, 60, 61]):
            printer.update('Starting\nTotal: 0')
            printer.update('Waiting\nTotal: 1')
            printer.update('Waiting\nTotal: 2')
            printer.finish('Stopped\nTotal: 2')
        self.assertEqual(stream.getvalue(),
                         'Starting\nTotal: 0\n\nWaiting\nTotal: 2\n\nStopped\nTotal: 2\n')
        self.assertNotIn('\x1b', stream.getvalue())

    def test_terminal_redraw_never_wraps_or_exceeds_screen_height(self):
        stream = StringIO()
        with patch('tools.xiangqi_data.puzzle_mining.progress._supports_cursor', return_value=True), \
             patch('shutil.get_terminal_size', return_value=os.terminal_size((20, 5))):
            printer = DashboardPrinter(stream=stream)
            printer.update('x' * 100 + '\nsecond\nthird\nfourth\nfifth', force=True)
            printer.update('Waiting', force=True)
            printer.message('ERROR: test\x1b[2J\nmessage')
            printer.finish('Stopped')
        self.assertTrue(stream.getvalue().startswith('x' * 19 + '\nsecond\nthird\nfourth\n'))
        self.assertIn('\x1b[4A\r\x1b[JWaiting\n', stream.getvalue())
        self.assertIn('ERROR: test [2J message\n', stream.getvalue())
        self.assertEqual(printer.rows, 0)

    def dashboard(self):
        baseline = CheckmateInventory((
            CategoryInventory('centroidPawnMate', 'Centroid Pawn Mate', InventoryCounts(5, 2, 3)),
            CategoryInventory('octagonalHorse', 'Octagonal Horse', InventoryCounts()),
        ), InventoryCounts(5, 2, 3))
        dashboard = CheckmateDashboard(Mock(), baseline, workers=4, queued=100,
                                       continuous=True, poll_interval=5)
        dashboard.printer = Mock(width=100)
        return dashboard

    def test_categories_sources_and_net_growth_are_readable_at_both_widths(self):
        dashboard = self.dashboard()
        dashboard.inventory = CheckmateInventory((
            CategoryInventory('centroidPawnMate', 'Centroid Pawn Mate', InventoryCounts(7, 3, 4)),
            CategoryInventory('octagonalHorse', 'Octagonal Horse', InventoryCounts()),
        ), InventoryCounts(7, 3, 4))
        for width in (100, 40):
            dashboard.printer.width = width
            frame = dashboard.frame('Waiting', dashboard.started_at + 65)
            self.assertIn('Centroid Pawn Mate', frame)
            self.assertIn('Octagonal Horse', frame)
            self.assertIn('+2', frame)
            self.assertIn('Local database', frame)
            self.assertIn('0:01:05', frame)
            self.assertTrue(all(len(line) <= width for line in frame.splitlines()))
            for noise in ('untagged', 'published', 'rejected', 'review'):
                self.assertNotIn(noise, frame)

    def test_inventory_queries_are_throttled_and_refresh_on_external_change(self):
        dashboard = self.dashboard()
        dashboard.connection.execute.return_value.fetchone.side_effect = [(1,), (1,), (2,), (2,)]
        with patch('tools.xiangqi_data.puzzle_mining.checkmate_dashboard.time.monotonic',
                   side_effect=[0, 1, 5, 10, 11]), \
             patch('tools.xiangqi_data.puzzle_mining.checkmate_dashboard.load_checkmate_inventory',
                   return_value=dashboard.baseline) as load:
            for _ in range(4):
                dashboard.render('Waiting')
            self.assertEqual(load.call_count, 2)
            dashboard.finish('Stopped')
            self.assertEqual(load.call_count, 3)


if __name__ == '__main__':
    unittest.main()

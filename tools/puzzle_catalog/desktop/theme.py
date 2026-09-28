"""Self-contained Qt theme inspired by the Copytrader studio layout."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    background: str = "#08101C"
    surface: str = "#101A2B"
    surface_alt: str = "#0D1727"
    accent: str = "#49B9F5"
    success: str = "#38D9A0"
    warning: str = "#F4BA60"
    danger: str = "#FF8190"
    text: str = "#F3F7FF"
    muted: str = "#A0AEC2"


THEME = Theme()
SPACING = {"sm": 8, "md": 12, "lg": 16, "xl": 24}


def stylesheet():
    return """
    QWidget { background: transparent; color: #F3F7FF; font-family: "Segoe UI"; font-size: 10pt; }
    QMainWindow, QDialog, QMessageBox { background: #08101C; }
    QFrame#SurfaceCard { background: qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #132139,stop:1 #0E1828); border: 1px solid #213049; border-radius: 16px; }
    QLabel { border: none; background: transparent; }
    QLabel[role="title"] { font-size: 25px; font-weight: 650; color: #F3F7FF; }
    QLabel[role="section"] { font-size: 16px; font-weight: 600; }
    QLabel[role="metric"] { font-size: 34px; font-weight: 650; color: #70C5F7; }
    QLabel[role="brand"] { font-size: 46px; color: #5CC7FD; font-family: "Microsoft YaHei"; }
    QLabel[role="muted"] { color: #A0AEC2; font-size: 12px; }
    QLabel[role="small"] { color: #8292AA; font-size: 11px; }
    QLabel[role="eyebrow"] { color: #62B1DA; font-size: 10px; font-weight: 600; }
    QLabel[role="notice"] { background: #102838; color: #A5D9EE; border: 1px solid #254959; border-radius: 9px; padding: 12px; }
    QLabel[role="notice"][error="true"] { background: #351C2A; color: #FFB8B8; border-color: #6A3241; }
    QPushButton { background: #17263A; color: #DCEAF7; border: 1px solid #2A3E56; border-radius: 8px; padding: 8px 12px; min-height: 19px; }
    QPushButton:hover { border-color: #57B2E6; background: #20364E; }
    QPushButton:pressed { background: #102D44; }
    QPushButton:disabled { color: #607189; background: #111D2C; border-color: #1C2B3D; }
    QPushButton#PrimaryButton { background: #4AB5EE; color: #071B2C; font-weight: 650; border-color: #4AB5EE; }
    QPushButton#PrimaryButton:hover { background: #7BCDFA; }
    QPushButton#PrimaryButton:disabled { background: #24465E; color: #708DA1; border-color: #24465E; }
    QPushButton#WorkspaceTab { text-align: left; border: none; background: transparent; padding: 13px 10px; }
    QPushButton#WorkspaceTab:checked { background: #1B3850; color: #7AD2FF; }
    QPushButton#WorkspaceTab:hover { background: #182E43; }
    QLineEdit, QComboBox, QSpinBox { background: #0C1626; border: 1px solid #2A3C51; border-radius: 7px; padding: 7px; min-height: 19px; selection-background-color: #2F6891; }
    QLineEdit:focus,QComboBox:focus,QSpinBox:focus { border-color: #57B2E6; }
    QComboBox::drop-down { border: none; width: 22px; }
    QComboBox QAbstractItemView { background: #14263C; selection-background-color: #285175; padding: 6px; }
    QTableView { background: #0C1727; alternate-background-color: #101E30; border: 1px solid #21344D; border-radius: 8px; selection-background-color: #234765; selection-color: #FFFFFF; }
    QTableView::item { padding: 5px; border-bottom: 1px solid #1B2A3E; }
    QTableView::item:hover { background: #1A334C; }
    QHeaderView::section { background: #17263A; color: #A8BCD0; border: 0; border-bottom: 1px solid #2E435C; padding: 10px 6px; font-size: 11px; font-weight: 600; }
    QPlainTextEdit { background: #081321; color: #B4C8DA; border: 1px solid #23374D; border-radius: 8px; padding: 9px; font-family: "Cascadia Code","Consolas"; font-size: 11px; }
    QProgressBar { background: #091522; border: 1px solid #22344B; border-radius: 6px; min-height: 20px; text-align: center; color: #E0F0FC; font-size: 11px; }
    QProgressBar::chunk { background: #26617F; border-radius: 5px; }
    QLabel#HelpIcon { border: 1px solid #63849C; border-radius: 7px; min-width: 14px; max-width: 14px; min-height: 14px; max-height: 14px; padding-left: 4px; font-size: 10px; }
    QScrollArea { border: none; }
    QScrollBar:vertical { background: #0B1625; width: 10px; margin: 0; }
    QScrollBar::handle:vertical { background: #2C425D; border-radius: 5px; min-height: 30px; }
    QScrollBar:horizontal { background: #0B1625; height: 10px; margin: 0; }
    QScrollBar::handle:horizontal { background: #2C425D; border-radius: 5px; min-width: 30px; }
    QScrollBar::add-line,QScrollBar::sub-line { width: 0; height: 0; }
    QScrollBar::add-page,QScrollBar::sub-page { background: transparent; }
    QSplitter::handle { background: #122337; }
    QToolTip { background: #183148; color: #E2EFF9; border: 1px solid #4A82A3; padding: 8px; }
    QListWidget { background: #0D1C2D; border: 1px solid #243E55; padding: 6px; }
    QListWidget::item { padding: 7px; }
    QCheckBox { spacing: 9px; }
    QCheckBox::indicator { width: 14px; height: 14px; border: 1px solid #63849C; border-radius: 3px; background: #0D1C2D; }
    QCheckBox::indicator:checked { background: #40B3E2; border-color: #40B3E2; }
    QStatusBar { color: #91A6BA; font-size: 11px; }
    """


def apply(app):
    app.setStyle("Fusion")
    app.setStyleSheet(stylesheet())

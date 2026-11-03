from pathlib import Path

from tools.xiangqi_data.native_rules import NativeRules
from .records import Unsupported


class Validator(NativeRules):
    def __init__(self):
        super().__init__()
        self.source = Path(__file__).with_name("JieqiRules.java")

    def validate(self, record):
        state = self.position(record.initial_fen, record.moves)
        if state["gameResult"] != "*" and record.result != "*" and state["gameResult"] != record.result:
            raise Unsupported("Published result contradicts native terminal position")

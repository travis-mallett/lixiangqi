package lila.gathering

class PrizeTest extends munit.FunSuite:

  test("richText prize regex not find btc >> url"):
    assert(!looksLikePrize("HqVrbTcy"))
    assert(looksLikePrize("10btc"))
    assert(looksLikePrize("ten btc"))
    assert(looksLikePrize("ten btc!"))
    assert(!looksLikePrize("[tour](lixiangqi.org/tournament/BTCIkJvg) "))
    assert(!looksLikePrize("[tour](lixiangqi.org/tournament/aaBTCIvg) "))

  test("richText prize regex for TA description"):
    assert:
      looksLikePrize("""Blitz Titled Arena July '23 Prizes: $500/$250/$125/$75/$50

  [Warm-up event](https://lixiangqi.org/tournament/jul23bua) """)

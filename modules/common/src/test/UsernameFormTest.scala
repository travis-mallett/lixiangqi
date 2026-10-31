package lila.common

import play.api.data.Form
import play.api.data.Forms.single

class UsernameFormTest extends munit.FunSuite:
  test("existing account forms accept thirty Unicode code points"):
    val form = Form(single("username" -> lila.common.Form.username.historicalField))
    assert(form.bind(Map("username" -> ("𠮷" * 30))).errors.isEmpty)
    assert(form.bind(Map("username" -> ("𠮷" * 31))).hasErrors)

  test("server rendered mentions and profile links include the full Chinese name"):
    given lila.core.config.NetDomain = lila.core.config.NetDomain("lixiangqi.com")
    val rendered = RawHtml.addLinks("@象棋Player88，https://lixiangqi.com/@/𠮷野").value
    assert(rendered.contains("/@/象棋Player88"))
    assert(rendered.contains("/@/𠮷野"))

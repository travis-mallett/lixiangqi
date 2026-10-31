package lila.core.game

/** Versioned, server-owned character profiles. Never interpret client-supplied engine settings. */
object KidsBotProfile:
  case class Profile(id: String, level: Int, style: String):
    def key = s"v1/$id"

  val all = List(
    Profile("sun-sun", 9, "defense"),
    Profile("qing-tuan", 1, "gentle"),
    Profile("xiao-lan", 276, "chariot"),
    Profile("yan-yan", 98, "horse"),
    Profile("ying-ying", 453, "cannon"),
    Profile("dong-dong", 9, "gentle"),
    Profile("si-si", 364, "defense"),
    Profile("ling-ling", 187, "defense"),
    Profile("mo-mo", 631, "defense"),
    Profile("suan-suan", 542, "capture"),
    Profile("cai-cai", 364, "capture"),
    Profile("wa-wa", 720, "defense"),
    Profile("jian-jian", 98, "chariot"),
    Profile("kou-kou", 1, "gentle"),
    Profile("sang-sang", 9, "gentle"),
    Profile("he-he", 187, "cannon"),
    Profile("dou-dou", 1, "gentle"),
    Profile("hu-hu", 453, "chariot"),
    Profile("dan-dan", 276, "chariot"),
    Profile("jin-jin", 542, "horse"),
    Profile("tuan-tuan", 364, "defense"),
    Profile("zhuang-zhuang", 631, "defense"),
    Profile("xiao-he", 187, "capture"),
    Profile("a-chuan", 276, "horse"),
    Profile("ning-ning", 542, "defense"),
    Profile("teacher-lin", 720, "defense")
  )
  def byId(id: String): Option[Profile] = all.find(_.id == id)
  def byKey(key: String): Option[Profile] = all.find(_.key == key)

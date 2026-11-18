package lila.user

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.core.security.HashedPassword
import lila.core.user.FlagCode
import lila.db.dsl.{ *, given }

class SignupCountryPersistenceTest extends munit.FunSuite:
  if sys.env.contains("LIXIANGQI_EXTERNAL_LOGIN_TEST_URI") then
    test("signup countries survive account loading and use the profile BSON schema"):
      given Executor = scala.concurrent.ExecutionContext.global
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val driver = new AsyncDriver()
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_EXTERNAL_LOGIN_TEST_URI")))
      val db = waitFor(
        connection.database("signup_country_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      val coll = db.collection[lila.db.dsl.Coll]("user4")
      val users = UserRepo(coll)
      try
        for
          provider <- List(None, Some("google"), Some("lichess"), Some("lishogi"))
          flag <- List(None, Some(FlagCode("CN")), Some(FlagCode("ES-GA")))
        do
          val name = UserName("signup" + java.util.UUID.randomUUID().toString.replace("-", "").take(12))
          val user = waitFor(
            users.create(
              name,
              Option.when(provider.isEmpty)(HashedPassword(Array.fill(39)(1.toByte))),
              EmailAddress(s"${name.value}@example.org"),
              false,
              false,
              externalIdentity = provider.map(p => s"$p:${name.value}"),
              flag = flag
            )
          ).get
          assertEquals(user.profileOrDefault.flag, flag)
          assertEquals(waitFor(users.byId(user.id)).get.profileOrDefault.flag, flag)
          val stored = waitFor(coll.byId[Bdoc](user.id)).get
          val profile = stored.getAsOpt[Bdoc]("profile")
          assertEquals(profile.flatMap(_.getAsOpt[String]("country")), flag.map(_.value))
          assertEquals(profile.flatMap(_.getAsOpt[String]("flag")), None)
      finally
        waitFor(db.drop())
        waitFor(driver.close())

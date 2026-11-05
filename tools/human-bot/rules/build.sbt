import org.scalajs.linker.interface.ModuleKind

lazy val root = project
  .in(file("."))
  .enablePlugins(ScalaJSPlugin)
  .settings(
    scalaVersion := "3.8.4",
    scalafmtConfig := baseDirectory.value / "../../../.scalafmt.conf",
    scalaJSLinkerConfig ~= (_.withModuleKind(ModuleKind.ESModule)),
    Compile / fullLinkJS / scalaJSLinkerConfig ~= (_.withSourceMap(false)),
    Compile / fullLinkJS / scalaJSLinkerOutputDirectory :=
      baseDirectory.value / "../../../ui/humanBot/dist/rules",
    Compile / unmanagedSources ++= {
      val repository = baseDirectory.value / "../../.."
      ((repository / "modules/xiangqi/src/main") ** "*.scala").get() ++
        ((repository / "modules/threeKingdomsCore/src/main") ** "*.scala").get()
    },
    libraryDependencies ++= Seq(
      "org.typelevel" % "cats-core_sjs1_3" % "2.13.0",
      "org.playframework" % "play-json_sjs1_3" % "3.0.6"
    )
  )

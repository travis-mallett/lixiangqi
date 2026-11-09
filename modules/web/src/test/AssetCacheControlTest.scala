package lila.web

class AssetCacheControlTest extends munit.FunSuite:
  test("content-addressed build outputs survive idle sessions without refetching"):
    for
      path <- List(
        "/assets/css/site.a309008d.css",
        "/assets/compiled/site.VGNAH4C4.js",
        "/assets/compiled/i18n/site.en-GB.3225f56646da.js",
        "/assets/hashed/lixiangqi-default.18d1f813.svg"
      )
      status <- List(200, 206, 304)
    do assertEquals(AssetCacheControl(path, status), "public, max-age=31536000, immutable")

  test("mutable manifests, worker entry points and styles must revalidate"):
    List(
      "/assets/compiled/manifest.json",
      "/assets/compiled/serviceWorker.js",
      "/assets/pikafish-web/manifest.json",
      "/assets/css/site.css"
    ).foreach(path => assertEquals(AssetCacheControl(path, 200), "no-cache"))

  test("unfingerprinted images retain a short cache without claiming immutability"):
    List("/assets/_IT7Lzk/images/board/default.svg", "/assets/images/example.deadbeef.svg").foreach: path =>
      assertEquals(AssetCacheControl(path, 200), "public, max-age=3600")

  test("missing and temporarily unavailable assets cannot poison the browser cache"):
    List(301, 302, 404, 429, 500, 503).foreach: status =>
      assertEquals(AssetCacheControl("/assets/css/site.a309008d.css", status), "no-store")

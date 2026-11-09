package lila.web
package ui

import scalatags.Text.all.*
import lila.web.ui.AssetFullHelper

final class PieceSetImages(assets: AssetFullHelper, shadows: List[(String, String)]):

  private val cache = scala.collection.concurrent.TrieMap.empty[String, String]

  lila.common.Bus.sub[AssetManifestUpdate.type](_ => cache.clear())

  def load(pieceSet: String, vars: List[(String, String)]): Frag = raw:
    cache.getOrElseUpdate(
      pieceSet, {
        val images = vars ++ shadows
        val css = s"<style>:root{"
          + images.map { (path, name) => s"$name:url(${assets.assetUrl(path)});" }.mkString
          + "}</style>"
        if images.exists { (path, _) => assets.manifest.hashed(path).isEmpty }
        then lila.log.system.error(s"$pieceSet manifest incomplete")
        css
      }
    )

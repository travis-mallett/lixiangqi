package lila.web
package ui

import scalatags.Text.all.*
import lila.web.ui.AssetFullHelper

final class PieceSetImages(assets: AssetFullHelper):

  private val cache = scala.collection.concurrent.TrieMap.empty[String, String]

  private val shadows = List(
    "piece/effects/xiangqi-rest-shadow.png" -> "--xiangqi-rest-shadow-image",
    "piece/effects/xiangqi-airborne-shadow.png" -> "--xiangqi-airborne-shadow-image"
  )

  lila.common.Bus.sub[AssetManifestUpdate.type](_ => cache.clear())

  def load(pieceSet: String, vars: List[(String, String)]): Frag = raw:
    cache.getOrElseUpdate(
      pieceSet, {
        val images = vars ++ shadows
        val css = s"<style>:root{"
          + images.map { (path, name) => s"$name:url(${assets.assetUrl(path)});" }.mkString
          + "}</style>" + images.map { (path, _) =>
            s"""<link rel="preload" as="image" href="${assets.assetUrl(path)}" />"""
          }.mkString
        if images.exists { (path, _) => assets.manifest.hashed(path).isEmpty }
        then lila.log.system.error(s"$pieceSet manifest incomplete")
        css
      }
    )

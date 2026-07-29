package controllers

import lila.app.*

final class GameCatalog(env: Env) extends LilaController(env):

  def index = Open:
    Ok.page(views.xiangqi.gamesDatabase(env.fishnet.explorerEndpoint))

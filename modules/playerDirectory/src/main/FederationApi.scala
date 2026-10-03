package lila.playerDirectory

import lila.core.playerDirectory.Federation.*

final class FederationApi(repo: DirectoryRepo)(using Executor):

  export repo.federation.fetch

  def find(str: String): Fu[Option[Federation]] =
    Federation.find(str).so(fetch)

  def getName(id: Id): Fu[Option[Name]] =
    fetch(id).map2(_.name)

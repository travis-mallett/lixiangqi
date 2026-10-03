package lila.studySearch

import scalalib.paginator.*
import lila.core.study.StudyOrder
import lila.study.{ Study, StudySearch }

final class Env(studyRepo: lila.study.StudyRepo, pager: lila.study.StudyPager)(using Executor):
  def apply(text: String, order: StudyOrder, page: Int)(using me: Option[Me]) =
    val query = StudySearch.parse(text)
    Paginator[Study.WithChaptersAndLiked](
      adapter = new AdapterLike[Study]:
        def nbResults = studyRepo.countSearch(query, me.map(_.userId))
        def slice(offset: Int, length: Int) = studyRepo.search(query, order, me.map(_.userId), offset, length)
      .mapFutureList(pager.withChaptersAndLiking()),
      currentPage = page,
      maxPerPage = pager.maxPerPage
    )

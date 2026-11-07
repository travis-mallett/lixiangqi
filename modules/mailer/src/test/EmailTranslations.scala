package lila.i18n

object EmailTranslations:
  def load(): Unit = Registry.syncLoadLanguages()

  // Inspect the locale's own catalog, not Registry.translation's English fallback.
  def hasOwnTranslation(lang: play.api.i18n.Lang, key: lila.core.i18n.I18nKey): Boolean =
    Registry.getAll(lang).exists(_.containsKey(key))

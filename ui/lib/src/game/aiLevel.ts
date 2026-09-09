/** User-facing names for LiXiangQi's numeric computer opponent profiles. */
export const aiLevelName = (level: number): string =>
  [
    i18n.site.aiLevelNewcomer,
    i18n.site.aiLevelRookie,
    i18n.site.aiLevelInitiate,
    i18n.site.aiLevelElementary,
    i18n.site.aiLevelIntermediate,
    i18n.site.aiLevelAdvanced,
    i18n.site.aiLevelElite,
    i18n.site.aiLevelMaster,
    i18n.site.aiLevelGrandmaster,
  ][level - 1] || level.toString();

package lila.security

import lila.oauth.*

class MobileNotificationScopeTest extends munit.FunSuite:
  test("notifications are scoped separately from inbox, forum and administration"):
    assert(OAuthScope.byKey.get("mobile:notifications").contains(OAuthScope.Mobile.Notifications))
    val token = TokenScopes(List(OAuthScope.Mobile.Notifications))
    assert(EndpointScopes(List(OAuthScope.Mobile.Notifications)).compatible(token))
    assert(!token.mobile)
    assert(!EndpointScopes(List(OAuthScope.Mobile.Inbox)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Mobile.Forum)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Web.Mod)).compatible(token))

package lila.security

import lila.oauth.*

class MobileForumScopeTest extends munit.FunSuite:
  test("forum permission is registered and isolated from account administration"):
    assert(OAuthScope.byKey.get("mobile:forum").contains(OAuthScope.Mobile.Forum))
    val token = TokenScopes(List(OAuthScope.Mobile.Forum))
    assert(EndpointScopes(List(OAuthScope.Mobile.Forum)).compatible(token))
    assert(!token.mobile)
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Mobile.Inbox)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Web.Mod)).compatible(token))

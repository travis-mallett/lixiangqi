package lila.security

import lila.oauth.{ AuthorizationRequest, EndpointScopes, OAuthScope, TokenScopes }

class KidModeScopeTest extends munit.FunSuite:
  test("Kids permission can enable Kid mode without granting preference writes"):
    val kids = TokenScopes(List(OAuthScope.Kid.Enable))
    assert(EndpointScopes(List(OAuthScope.Kid.Enable)).compatible(kids))
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(kids))
    assert(!EndpointScopes(List(OAuthScope.Kid.Enable)).compatible(TokenScopes(Nil)))

  test("browser authorization accepts the Kids enable-only permission"):
    val scopes = AuthorizationRequest.readScopes("puzzle:read puzzle:write kid:enable mobile:play")
    assert(scopes.isRight)
    assert(OAuthScope.byKey.get("kid:enable").contains(OAuthScope.Kid.Enable))

  test("Kids gameplay does not grant messaging or preference changes"):
    val kids = TokenScopes(List(OAuthScope.Kid.Enable, OAuthScope.Mobile.Play))
    assert(EndpointScopes(List(OAuthScope.Mobile.Play)).compatible(kids))
    assert(!EndpointScopes(List(OAuthScope.Mobile.Inbox)).compatible(kids))
    assert(!EndpointScopes(List(OAuthScope.Mobile.Forum)).compatible(kids))
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(kids))

package lila.security

import lila.oauth.{ AuthorizationRequest, EndpointScopes, OAuthScope, TokenScopes }

class MobileTournamentScopeTest extends munit.FunSuite:
  test("native tournaments use the existing narrow tournament permission"):
    assert(AuthorizationRequest.readScopes("mobile:play tournament:write").isRight)
    val endpoint = EndpointScopes(List(OAuthScope.Tournament.Write))
    assert(endpoint.compatible(TokenScopes(List(OAuthScope.Tournament.Write))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Mobile.Play))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Puzzle.Write))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Kid.Enable))))

  test("tournament access grants neither gameplay nor signed-web administration"):
    val token = TokenScopes(List(OAuthScope.Tournament.Write))
    assert(!token.mobile)
    assert(!EndpointScopes(List(OAuthScope.Mobile.Play)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(token))
    assert(!EndpointScopes(List(OAuthScope.Web.Mod)).compatible(token))

package lila.security

import lila.oauth.{ AuthorizationRequest, EndpointScopes, OAuthScope, TokenScopes }

class MobilePlayScopeTest extends munit.FunSuite:
  test("native human play is an explicit OAuth permission"):
    val scopes = AuthorizationRequest.readScopes("puzzle:read puzzle:write mobile:play")
    assert(scopes.isRight)
    assert(OAuthScope.byKey.get("mobile:play").contains(OAuthScope.Mobile.Play))
    val endpoint = EndpointScopes(List(OAuthScope.Mobile.Play))
    assert(endpoint.compatible(TokenScopes(List(OAuthScope.Mobile.Play))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Puzzle.Read, OAuthScope.Puzzle.Write))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Kid.Enable))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Board.Play))))

  test("native play grants no broader signed-web or account modification permission"):
    val play = TokenScopes(List(OAuthScope.Mobile.Play))
    assert(!play.mobile)
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(play))
    assert(!EndpointScopes(List(OAuthScope.Web.Mod)).compatible(play))

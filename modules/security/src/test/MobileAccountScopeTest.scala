package lila.security

import lila.oauth.{ AuthorizationRequest, EndpointScopes, OAuthScope, TokenScopes }

class MobileAccountScopeTest extends munit.FunSuite:
  test("account management requires its own explicit dangerous scope"):
    assert(AuthorizationRequest.readScopes("mobile:account").isRight)
    val endpoint = EndpointScopes(List(OAuthScope.Mobile.Account))
    assert(endpoint.compatible(TokenScopes(List(OAuthScope.Mobile.Account))))
    List(OAuthScope.Kid.Enable, OAuthScope.Preference.Write, OAuthScope.Mobile.Play, OAuthScope.Mobile.Inbox)
      .foreach: scope =>
        assert(!endpoint.compatible(TokenScopes(List(scope))))
    assert(OAuthScope.dangerList.has(_.Mobile.Account))
    assert(!TokenScopes(List(OAuthScope.Mobile.Account)).mobile)

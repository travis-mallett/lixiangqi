package lila.security

import lila.oauth.{ AuthorizationRequest, EndpointScopes, OAuthScope, TokenScopes }

class MobileInboxScopeTest extends munit.FunSuite:
  test("native Inbox requires a separate permission"):
    assert(AuthorizationRequest.readScopes("mobile:inbox").isRight)
    assert(OAuthScope.byKey.get("mobile:inbox").contains(OAuthScope.Mobile.Inbox))
    val endpoint = EndpointScopes(List(OAuthScope.Mobile.Inbox))
    assert(endpoint.compatible(TokenScopes(List(OAuthScope.Mobile.Inbox))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Mobile.Play))))
    assert(!endpoint.compatible(TokenScopes(List(OAuthScope.Kid.Enable))))

  test("Inbox grants no signed-web or account modification permission"):
    val inbox = TokenScopes(List(OAuthScope.Mobile.Inbox))
    assert(!inbox.mobile)
    assert(!EndpointScopes(List(OAuthScope.Preference.Write)).compatible(inbox))
    assert(!EndpointScopes(List(OAuthScope.Web.Mod)).compatible(inbox))

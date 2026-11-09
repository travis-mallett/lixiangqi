# Official site name — November 8, 2026

The deployment template ../lixiangqi-beta-deployment/templates/lila-application.beta.conf now sets net.site.name to Lixiangqi. push-local-live.ps1 copies that template into the release configuration. The shared navigation renderer displays this name as lowercase lixiangqi; browser titles and Open Graph site_name retain Lixiangqi. No migration is required. These changes take effect on the next ordinary website deployment; this task does not deploy.

Source: website HEAD 486935b00c38e831232b7c1db91f10eeb968e428.
Working-tree SHA-256: modules/web/src/main/ui/layout.scala = 57f9caca977a173785cc9d85298d02b89fee37083c74e84a0565e88d76e96df6.
Deployment template SHA-256: d1ee656ebb5a8f70c8e1ef68173e058d34fb9484f938c0b02c67960843a33bc4.

Mobile reconciliation: read both apps' instructions and reconciliation reports, and inspected lib/l10n/app_en.arb in each. Main app: not applicable; its independent appTitle is already LiXiangQi and it does not render the website navigation or HTML page title. Kids: not applicable; its independent appTitle is Xiangqi Kids. No API, account, gameplay, board or native branding change is required. Neither app needs a release. Existing checkpoints and unrelated pending reviews remain unchanged.

Verification: traced the deployment copy and shared navigation, browser-title and Open Graph consumers. Native builds are unnecessary because neither app changed. No commit or push is prepared by this task.

Validation result: web / scalafmtCheck and web / compile passed. Full CI and browser rendering were not run for this label-only change. The documentation formatter could not run with the sandbox's pnpm environment.

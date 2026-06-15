// ─────────────────────────────────────────────────────────────────────────────
// AuthStage  (RF5 — credential memory hygiene)
//
// Reads username + password from SealedCredentials exactly once, then calls
// credentials.seal() in a finally block so the strings are zeroed whether
// login succeeds, fails, or throws. No caller downstream ever sees plaintext
// credentials again.
// ─────────────────────────────────────────────────────────────────────────────

import type { PipelineStage } from '../PipelineStage';
import type { PipelineContext, WorkflowInput } from '../PipelineContext';
import type { AuthSession } from '../../../core/ports/agents/IAuthAgent';
import { AuthAgent } from '../../../agents/auth/AuthAgent';

export class AuthStage implements PipelineStage<WorkflowInput, AuthSession> {
  readonly name = 'Authentication';

  constructor(private readonly agent: AuthAgent = new AuthAgent()) {}

  async run(input: WorkflowInput, ctx: PipelineContext): Promise<AuthSession> {
    // ── Read credentials before sealing ─────────────────────────────────────
    // We extract to locals so the seal() call in finally doesn't break the
    // login() invocation, and to ensure the strings leave scope after this
    // method returns.
    const username = input.credentials.username;
    const password = input.credentials.password;

    let session: AuthSession;
    try {
      session = await this.agent.login({
        url: input.url,
        username,
        password,
      });
    } finally {
      // RF5: zero credentials immediately after the auth call — win or lose.
      input.credentials.seal();
    }

    if (!session.authenticated) {
      // Store browser session so the orchestrator can close it cleanly.
      ctx.browserSession = { browser: session.browser, context: session.context };
      throw new Error(
        `Authentication failed for ${input.url}. ` +
        `Check credentials or login URL. Landed on: ${session.landedUrl}`,
      );
    }

    // Hand the live session to downstream stages via context.
    ctx.browserSession = { browser: session.browser, context: session.context };

    return session;
  }
}

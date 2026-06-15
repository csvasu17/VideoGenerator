import { AuthStage }           from '../AuthStage';
import { SealedCredentials }   from '../../../../core/domain/entities/Credentials';
import type { AuthSession }     from '../../../../core/ports/agents/IAuthAgent';
import type { PipelineContext, WorkflowInput } from '../../PipelineContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeContext(): PipelineContext {
  const { ContextEnvelope } = require('../../../../core/domain/entities/context/ContextEnvelope');
  return {
    input:           null as unknown as WorkflowInput, // stage reads from its own `input` param
    contextEnvelope: ContextEnvelope.empty(),
  };
}

function makeInput(overrides?: Partial<WorkflowInput>): WorkflowInput {
  return {
    url:         'https://app.example.com',
    credentials: new SealedCredentials('user@acme.com', 'p@ssword'),
    outputDir:   '/tmp/demo',
    ...overrides,
  };
}

/** Stub AuthAgent with a controllable outcome. */
function makeAgent(authenticated: boolean, throws?: Error) {
  return {
    async login(): Promise<AuthSession> {
      if (throws) throw throws;
      return {
        browser:         {} as never,
        context:         { close: async () => {} } as never,
        authenticated,
        landedUrl:       authenticated ? 'https://app.example.com/dashboard' : 'https://app.example.com/login',
        authenticatedAt: new Date().toISOString(),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthStage security tests  (RF5)
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthStage — credential sealing (RF5)', () => {

  describe('successful authentication', () => {
    it('seals credentials after a successful login', async () => {
      const input  = makeInput();
      const stage  = new AuthStage(makeAgent(true) as never);
      const ctx    = makeContext();

      await stage.run(input, ctx);

      expect(input.credentials.isSealed).toBe(true);
    });

    it('populates ctx.browserSession on success', async () => {
      const input = makeInput();
      const stage = new AuthStage(makeAgent(true) as never);
      const ctx   = makeContext();

      await stage.run(input, ctx);

      expect(ctx.browserSession).toBeDefined();
    });

    it('credentials are inaccessible after successful run', async () => {
      const input = makeInput();
      const stage = new AuthStage(makeAgent(true) as never);
      await stage.run(input, makeContext());

      expect(() => input.credentials.username).toThrow();
      expect(() => input.credentials.password).toThrow();
    });
  });

  describe('failed authentication (wrong credentials)', () => {
    it('seals credentials even when login returns authenticated:false', async () => {
      const input = makeInput();
      const stage = new AuthStage(makeAgent(false) as never);
      const ctx   = makeContext();

      // Stage throws because authenticated === false, but credentials must be sealed
      await expect(stage.run(input, ctx)).rejects.toThrow();

      expect(input.credentials.isSealed).toBe(true);
    });

    it('populates ctx.browserSession for cleanup even on failed auth', async () => {
      const input = makeInput();
      const stage = new AuthStage(makeAgent(false) as never);
      const ctx   = makeContext();

      await expect(stage.run(input, ctx)).rejects.toThrow();

      expect(ctx.browserSession).toBeDefined();
    });
  });

  describe('agent throws an exception', () => {
    it('seals credentials when agent.login() throws', async () => {
      const input = makeInput();
      const stage = new AuthStage(makeAgent(true, new Error('network timeout')) as never);
      const ctx   = makeContext();

      await expect(stage.run(input, ctx)).rejects.toThrow('network timeout');

      expect(input.credentials.isSealed).toBe(true);
    });
  });

  describe('error messages', () => {
    it('does not include the plaintext password in the thrown error', async () => {
      const input = makeInput({ credentials: new SealedCredentials('user', 'super-secret-pw') });
      const stage = new AuthStage(makeAgent(false) as never);

      let message = '';
      try { await stage.run(input, makeContext()); } catch (e) { message = (e as Error).message; }

      expect(message).not.toContain('super-secret-pw');
    });

    it('does not include the username in the thrown error', async () => {
      const input = makeInput({ credentials: new SealedCredentials('secret-user@corp.com', 'pass') });
      const stage = new AuthStage(makeAgent(false) as never);

      let message = '';
      try { await stage.run(input, makeContext()); } catch (e) { message = (e as Error).message; }

      expect(message).not.toContain('secret-user@corp.com');
    });
  });
});

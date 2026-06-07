import { Link, createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import '~/styles/marketing-home.css';

export const Route = createFileRoute('/(marketing)/')({
  component: RouteComponent,
});

const GH = 'https://github.com/foreveryh/oxygenie';
const GH_DEPLOY = 'https://github.com/foreveryh/oxygenie/blob/main/docs/deployment/dokploy.md';

function RouteComponent() {
  const c = useIntlayer('home');

  return (
    <div className="oxy-home">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="hero" id="top">
        <div className="wrap">
          <div className="tag">
            $ oxygenie up —— <b>self-hosted</b> · multi-model · sandboxed · open-source
          </div>
          <h1>
            <span className="soft">{c.hero.titleSoft}</span>
            <br />
            {c.hero.titleMain}
            <span className="cl">{c.hero.titleAccent}</span>
            <i className="cur" />
          </h1>
          <div className="sub">
            <div>
              <p>
                <b>{c.hero.subtitleStrong}</b> {c.hero.subtitle}
              </p>
              <div className="comment">// self-hosted · single-org · multi-user · fully-sandboxed</div>
              <div className="hero-cta">
                <Link className="btn-go" to="/agents/claude-chat">
                  {c.hero.ctaPrimary} <span className="ar">→</span>
                </Link>
                <a className="btn-ghost" href={GH} target="_blank" rel="noopener noreferrer">
                  {c.hero.ctaSecondary}
                </a>
              </div>
            </div>
            <div className="metaboard">
              <div>
                <span>docker compose up</span>
                {c.hero.metaDeploy}
              </div>
              <div>
                <span>ARK multi-model</span>
                {c.hero.metaModels}
              </div>
              <div>
                <span>per-session</span>
                {c.hero.metaSandbox}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Concept ───────────────────────────────────────────── */}
      <section className="concept" id="concept">
        <div className="wrap">
          <span className="eyebrow">
            <b>[01]</b> concept
          </span>
          <div className="lead">
            <h2>
              <span className="soft">{c.concept.h2Soft}</span>
              <br />
              {c.concept.h2Lead}
              <span className="cl"> {c.concept.h2Accent}</span>
            </h2>
            <div className="body">
              <p>{c.concept.bodyP1}</p>
              <p>{c.concept.bodyP2}</p>
            </div>
          </div>
          <div className="princip">
            <div className="p">
              <div className="num">01 / self-host</div>
              <h3>{c.concept.p1Title}</h3>
              <p>{c.concept.p1Desc}</p>
            </div>
            <div className="p">
              <div className="num">02 / multi-model</div>
              <h3>{c.concept.p2Title}</h3>
              <p>{c.concept.p2Desc}</p>
            </div>
            <div className="p">
              <div className="num">03 / sandbox</div>
              <h3>{c.concept.p3Title}</h3>
              <p>{c.concept.p3Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="features" id="features">
        <div className="wrap">
          <span className="eyebrow">
            <b>[02]</b> features
          </span>
          <h2>
            {c.features.heading} <span className="cl">{c.features.headingAccent}</span>
          </h2>
          <div className="fgrid">
            <div className="fcard">
              <div className="ix">01</div>
              <h3>{c.features.f1Title}</h3>
              <p>{c.features.f1Desc}</p>
            </div>
            <div className="fcard">
              <div className="ix">02</div>
              <h3>{c.features.f2Title}</h3>
              <p>{c.features.f2Desc}</p>
            </div>
            <div className="fcard">
              <div className="ix">03</div>
              <h3>{c.features.f3Title}</h3>
              <p>{c.features.f3Desc}</p>
            </div>
            <div className="fcard">
              <div className="ix">04</div>
              <h3>{c.features.f4Title}</h3>
              <p>{c.features.f4Desc}</p>
            </div>
            <div className="fcard">
              <div className="ix">05</div>
              <h3>{c.features.f5Title}</h3>
              <p>{c.features.f5Desc}</p>
            </div>
            <div className="fcard">
              <div className="ix">06</div>
              <h3>{c.features.f6Title}</h3>
              <p>{c.features.f6Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product mock ──────────────────────────────────────── */}
      <section className="product" id="product">
        <div className="wrap">
          <div className="head">
            <div>
              <span className="eyebrow">
                <b>[03]</b> product
              </span>
              <h2>
                {c.product.heading} <span className="cl">{c.product.headingAccent}</span>
              </h2>
            </div>
            <p className="note">
              // tool calls visible live
              <br />
              // output previews on tap
            </p>
          </div>

          <div className="app">
            <div className="app-top">
              <div className="l">
                <span className="cl">~/</span>oxygenie<span style={{ color: 'var(--line-2)' }}>/</span>
                <b>claude-chat</b>
              </div>
              <div className="st">
                <i /> model: glm-5.1 · sandbox · live
              </div>
            </div>
            <div className="app-body">
              <aside className="side">
                <div className="cap">sessions</div>
                <div className="sess on">
                  refactor landing<span className="w">running</span>
                </div>
                <div className="sess">
                  wire internal API<span className="w">resumed</span>
                </div>
                <div className="sess">
                  data-clean script<span className="w">2h ago</span>
                </div>
                <div className="sess">
                  weekly digest<span className="w">yesterday</span>
                </div>
              </aside>

              <div className="chat">
                <span className="eyebrow">
                  <b>session</b> · refactor landing
                </span>
                <div className="bubble user">
                  <div className="who">you</div>
                  <div className="tx">Reskin the landing to JumpX, then build.</div>
                </div>
                <div className="bubble ai">
                  <div className="who">oxygenie · glm-5.1</div>
                  <div className="tx">On it — updating design tokens and verifying the build —</div>
                </div>
                <div className="term">
                  <div className="bar">
                    <i className="r" />
                    <i />
                    <i /> &nbsp;bash · sandbox
                  </div>
                  <div className="body">
                    <span className="c"># runs in an isolated sandbox</span>
                    <br />
                    <span className="k">$</span> pnpm build
                    <br />
                    <span className="g">✓</span> built in 6.2s · 0 errors
                    <br />
                    <span className="k">$</span> <span className="tcur" />
                  </div>
                </div>
              </div>

              <aside className="rail">
                <div className="cap">output</div>
                <div className="deliv ok">
                  <span className="s">[ done ]</span>
                  <div className="tx">design tokens updated</div>
                </div>
                <div className="deliv now">
                  <span className="s">[ live ]</span>
                  <div className="tx">preview · index.html</div>
                </div>
                <div className="deliv">
                  <span className="s wait">[ todo ]</span>
                  <div className="tx">deploy to oxygenie.local</div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      {/* ── Models (dark) ─────────────────────────────────────── */}
      <section className="models" id="models">
        <div className="wrap">
          <span className="eyebrow">
            <b>[04]</b> models
          </span>
          <h2>
            {c.models.heading} <span className="cl">{c.models.headingAccent}</span>
            {c.models.headingTail}
          </h2>
          <p className="lede">{c.models.lede}</p>
          <div className="mgrid">
            <div className="mrow">
              <div>
                <div className="nm">GLM-5.1</div>
                <div className="id">ark/glm-5.1 · default</div>
              </div>
              <div className="h">
                <i /> healthy · 3.6s
              </div>
            </div>
            <div className="mrow">
              <div>
                <div className="nm">Doubao Seed 2.0 Code</div>
                <div className="id">ark/doubao-code · coding</div>
              </div>
              <div className="h">
                <i /> healthy · 5.3s
              </div>
            </div>
            <div className="mrow">
              <div>
                <div className="nm">Doubao Seed 2.0 Pro</div>
                <div className="id">ark/doubao-pro · general</div>
              </div>
              <div className="h">
                <i /> healthy · 2.1s
              </div>
            </div>
            <div className="mrow">
              <div>
                <div className="nm">MiniMax</div>
                <div className="id">ark/minimax · general</div>
              </div>
              <div className="h">
                <i /> healthy · 3.5s
              </div>
            </div>
          </div>
          <div className="mnote">
            // configured in <b>.env</b> + admin health board · per-conversation selection · selecting an
            unhealthy model <b>errors</b>, never a silent fallback
          </div>
        </div>
      </section>

      {/* ── Deploy ────────────────────────────────────────────── */}
      <section className="deploy" id="deploy">
        <div className="wrap">
          <div className="lead">
            <div>
              <span className="eyebrow">
                <b>[05]</b> deploy
              </span>
              <h2>
                {c.deploy.heading}
                <span className="cl">{c.deploy.headingAccent}</span>
                {c.deploy.headingTail}
              </h2>
              <p>{c.deploy.body}</p>
              <div className="hero-cta">
                <a className="btn-go" href={GH_DEPLOY} target="_blank" rel="noopener noreferrer">
                  {c.deploy.ctaPrimary} <span className="ar">→</span>
                </a>
                <a className="btn-ghost" href={GH} target="_blank" rel="noopener noreferrer">
                  {c.deploy.ctaSecondary}
                </a>
              </div>
            </div>
            <div className="term light">
              <div className="bar">
                <i className="r" />
                <i style={{ background: '#3a3833' }} />
                <i style={{ background: '#3a3833' }} /> &nbsp;deploy.sh
              </div>
              <div className="body">
                <span className="c"># three steps to launch</span>
                <br />
                <span className="k">$</span> git clone github.com/foreveryh/oxygenie
                <br />
                <span className="k">$</span> cp .env.example .env <span className="c"># add ARK token</span>
                <br />
                <span className="k">$</span> docker compose up -d
                <br />
                <span className="g">✓</span> oxygenie up · https://oxygenie.local
                <br />
                <span className="k">$</span> <span className="tcur" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="foot">
        <div className="wrap">
          <div className="big">
            {c.footer.bigPre}
            <span className="cl">{c.footer.bigAccent}</span>
            <i className="cur" />
          </div>
          <div className="frow">
            <div className="fmeta">
              <b>OxyGenie</b> · self-hosted Claude-Agent workspace
              <br />
              single-org · multi-user · fully-sandboxed · ARK multi-model
              <br />
              open-source · MIT · 2026
            </div>
            <a className="nbtn" href="#top">
              ↑ top
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

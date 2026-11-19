import Link from "next/link";
import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";
import { LEGAL_VERSION, MINIMUM_AGE, PRIVACY_EMAIL, SUPPORT_EMAIL, legalAddress, legalName } from "@/lib/legal";

/**
 * /terms: the Terms of Service (owner request, 11 November 2026: Privacy and Terms before launch). People agree to them
 * with one required tick box at sign-up (owner decision the same day), which also confirms they are 18 or older and
 * that they have read what Boredroom records: IP addresses, activity in the workspace and cookies ("What we record":
 * the owner asked for these to be in the terms people agree to).
 *
 * The product facts follow the code on 11 November 2026: payment is one checkout at a time through Paystack with
 * reminders 14, 7, 3 and 1 day before a period ends, nothing is charged automatically, an unpaid workspace moves to
 * Free's limits after a grace period and nothing is deleted. The refund rule, the liability cap and the governing law
 * are the owner's to confirm with a lawyer. A change in meaning changes LEGAL_VERSION (lib/legal.ts) in the same commit.
 */
const PATH = "/terms";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "agreement", label: "This agreement" },
  { id: "who", label: "Who can use Boredroom" },
  { id: "accounts", label: "Accounts and workspaces" },
  { id: "record", label: "What we record" },
  { id: "organisations", label: "If you run a workspace" },
  { id: "use", label: "Acceptable use" },
  { id: "brenda", label: "Brenda" },
  { id: "payment", label: "Plans and payment" },
  { id: "content", label: "Your content and ours" },
  { id: "ending", label: "Ending and suspension" },
  { id: "liability", label: "Warranties and liability" },
  { id: "law", label: "Law and disputes" },
  { id: "changes", label: "Changes and contact" },
];

export default function TermsPage() {
  return (
    <>
      <ArticleHeader path={PATH} lead={<p>The agreement between you and Boredroom. In force from {formatDate(LEGAL_VERSION)}.</p>} />
      <ArticleBody toc={TOC}>
        <h2 id="agreement">This agreement</h2>
        <p>Boredroom is operated by {legalName()}, {legalAddress()} (&ldquo;Boredroom&rdquo;, &ldquo;we&rdquo;). These terms cover boredroom.cc, the Boredroom app, Boredroom for Mac and the Brenda browser helper (together, &ldquo;the service&rdquo;).</p>
        <p>You agree to these terms, and confirm that you have read the <Link href="/privacy">Privacy Policy</Link>, when you tick the box and create an account. If you create a workspace for an organisation, you agree on its behalf and confirm you are allowed to.</p>

        <h2 id="who">Who can use Boredroom</h2>
        <ul>
          <li>You must be {MINIMUM_AGE} or older. Boredroom is a workplace tool and is not offered to anyone younger. By creating an account you confirm your age.</li>
          <li>You must give your real name and an email address you control.</li>
          <li>You must not use the service if we have suspended or closed your account before.</li>
        </ul>

        <h2 id="accounts">Accounts and workspaces</h2>
        <ul>
          <li>Keep your password to yourself. You are responsible for what is done through your account; tell us at once if you think someone else has used it.</li>
          <li>A workspace belongs to the organisation that created it. Its owner and HR decide who joins, what role each person has and which features are on, and they can remove a member.</li>
          <li>If you join a workspace, the work you record there belongs to that organisation, and its owner, HR and your team lead can see it as the <Link href="/privacy#see">Privacy Policy</Link> describes.</li>
        </ul>

        <h2 id="record">What we record</h2>
        <p>The full detail is in the <Link href="/privacy">Privacy Policy</Link>. By creating an account you agree in particular that:</p>
        <ul>
          <li><strong>IP address.</strong> We record your IP address and browser type when you sign up, sign in, reset a password or connect the Mac app, to keep accounts secure and investigate misuse. Boredroom support staff can see these records; your organisation cannot.</li>
          <li><strong>Activity in the workspace.</strong> We record what you do in the service: the tasks and timers you start and stop, when you clock in and out, your messages, and a log of actions such as approvals and changes. Your team lead, the owner and HR can see your work activity. We do not record your screen, your calls, your keystrokes or the websites you visit, and there is no productivity score.</li>
          <li><strong>Cookies.</strong> We set the cookies needed to sign you in and keep your account secure, listed in the <Link href="/privacy#cookies">Privacy Policy</Link>. We use no advertising or analytics cookies.</li>
          <li><strong>Emails.</strong> We send you emails about your account, security and billing. Product news is sent only if you ask for it, and you can unsubscribe from it at any time.</li>
        </ul>

        <h2 id="organisations">If you run a workspace</h2>
        <p>The organisation is responsible for how it uses Boredroom with its people. In particular it must:</p>
        <ul>
          <li>tell its staff what is recorded and who can see it, before they start, and have a lawful reason for recording it;</li>
          <li>add only people who are {MINIMUM_AGE} or older and who work with it;</li>
          <li>use attendance, time and report records fairly, and not as the only basis for a decision about someone&apos;s pay, discipline or employment;</li>
          <li>connect only apps and tools it has the right to connect, and take responsibility for what it lets Brenda do in them;</li>
          <li>answer its staff&apos;s requests about their data. We will help.</li>
        </ul>

        <h2 id="use">Acceptable use</h2>
        <p>You must not:</p>
        <ul>
          <li>break the law, or use the service to harass, threaten or discriminate against anyone;</li>
          <li>upload malware, or content you have no right to share;</li>
          <li>try to get into another organisation&apos;s workspace or another person&apos;s account;</li>
          <li>probe, overload or disrupt the service, or get around its limits;</li>
          <li>copy, resell or reverse engineer the service, except where the law allows it;</li>
          <li>use Brenda to make decisions about people without a person reviewing them, or to produce unlawful or deceptive content.</li>
        </ul>

        <h2 id="brenda">Brenda</h2>
        <ul>
          <li>Brenda is an AI assistant. Her answers, summaries and drafts can be wrong or incomplete. Check anything important before you rely on it.</li>
          <li>She asks before she sends, shares, buys or deletes anything for you. When you confirm, the action is yours.</li>
          <li>On your Mac and in Chrome she acts only when you ask, in the ways the <Link href="/privacy#brenda">Privacy Policy</Link> describes. You are responsible for what you ask her to do there, and for following the rules of the websites and apps she uses for you.</li>
          <li>Each plan includes a fair share of AI use. If an account goes far beyond it we may slow or pause Brenda for that account and will say so.</li>
        </ul>

        <h2 id="payment">Plans and payment</h2>
        <ul>
          <li><strong>Plans.</strong> The plans, their limits and their prices are on the <Link href="/pricing">pricing page</Link> and in the workspace&apos;s billing settings. The Free plan asks for no card.</li>
          <li><strong>Paying.</strong> A paid plan is paid in advance, for a month or a year, through Paystack. Paystack handles the card; we never see the full number.</li>
          <li><strong>Renewal.</strong> We remind the owner 14, 7, 3 and 1 day before a paid period or a trial ends. We do not take a renewal payment automatically: to continue, the owner or HR pays for the next period. If automatic renewal is offered later it will be off until you switch it on.</li>
          <li><strong>If a plan is not renewed.</strong> After a short grace period the workspace moves to the Free plan&apos;s limits. Nothing is deleted, and paying later brings the plan back.</li>
          <li><strong>Cancelling.</strong> There is no contract term. The owner or HR can move the workspace to Free at any time; the paid limits end when they do.</li>
          <li><strong>Refunds.</strong> Payments are not refunded for a period already started, unless the law requires it or we end a paid plan early for a reason that is not your breach, in which case we refund the unused part. If you were charged in error, write to us within 14 days.</li>
          <li><strong>Prices and taxes.</strong> We may change prices for future periods and will tell owners before a change applies to them. Prices exclude any taxes we must add.</li>
        </ul>

        <h2 id="content">Your content and ours</h2>
        <ul>
          <li>What you and your organisation put into Boredroom stays yours. You give us permission to store, process and display it only to provide the service to you.</li>
          <li>We do not use your workspace&apos;s content to train AI models.</li>
          <li>The service itself, its software, design and name, belongs to us. We give you a personal, non-transferable right to use it under these terms.</li>
          <li>If you send us ideas or feedback, we may use them without owing you anything.</li>
        </ul>

        <h2 id="ending">Ending and suspension</h2>
        <ul>
          <li>You can stop using Boredroom at any time and ask us to delete your account by writing to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. An owner can ask us to close a workspace.</li>
          <li>We may suspend or close an account or workspace that breaks these terms, puts others at risk, or stays unpaid. Where we reasonably can, we warn you first and give you a chance to put it right.</li>
          <li>For 30 days after a workspace closes, its owner can ask for a copy of its records. After that we delete them, except what the law requires us to keep.</li>
        </ul>

        <h2 id="liability">Warranties and liability</h2>
        <ul>
          <li>Boredroom is in a private pilot. We work to keep it available and correct, but we provide it &ldquo;as is&rdquo;: we do not promise it will be uninterrupted or free of errors, or that Brenda&apos;s output will be accurate.</li>
          <li>Boredroom is not a payroll, legal or HR adviser. Check its records before using them for pay or for decisions about people.</li>
          <li>To the extent the law allows, we are not liable for indirect or consequential loss, lost profit, or lost data that you could have kept a copy of.</li>
          <li>To the extent the law allows, our total liability to you or your organisation in any 12 months is limited to what your organisation paid us in those 12 months, or ₦100,000 if that is more.</li>
          <li>Nothing here limits liability that the law does not allow us to limit, or the rights you have as a consumer.</li>
          <li>If an organisation&apos;s breach of these terms leads to a claim against us, the organisation will cover our reasonable costs of that claim.</li>
        </ul>

        <h2 id="law">Law and disputes</h2>
        <p>These terms are governed by the laws of the Federal Republic of Nigeria. Tell us first if something goes wrong, at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, and we will try to settle it within 30 days. After that, the courts of Nigeria decide any dispute.</p>

        <h2 id="changes">Changes and contact</h2>
        <p>We may change these terms. If a change matters, we will email account holders at least 14 days before it takes effect. Using Boredroom after that date means you accept the new terms; if you do not, you can close your account.</p>
        <p>{legalName()}<br />{legalAddress()}<br /><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
      </ArticleBody>
    </>
  );
}

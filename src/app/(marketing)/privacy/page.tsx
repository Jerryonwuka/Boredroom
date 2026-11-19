import Link from "next/link";
import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { ScrollTable } from "@/components/marketing/blocks";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";
import { LEGAL_VERSION, MINIMUM_AGE, PRIVACY_EMAIL, legalAddress, legalName } from "@/lib/legal";

/**
 * /privacy: the Privacy Policy (owner request, 11 November 2026: Privacy and Terms before launch, written with the
 * Nigeria Data Protection Act 2023 in mind after the owner's reference, a data-protection lawyer's checklist: age check,
 * fonts that leak IP addresses, session recorders, marketing email without unsubscribe, renewal terms, profile pictures,
 * cookies).
 *
 * Every statement here describes what the code does on 11 November 2026 (the inventory of that day): what is stored,
 * who can read it, which services receive it and how long it is kept. A change to any of those (a new provider, a new
 * cookie, a new record, a different retention) changes this page and LEGAL_VERSION (lib/legal.ts) in the same commit.
 * Not legal advice: the owner's lawyer reviews the wording before it is relied on.
 */
const PATH = "/privacy";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "who", label: "Who we are" },
  { id: "collect", label: "What we collect" },
  { id: "never", label: "What we never collect" },
  { id: "see", label: "Who can see your data" },
  { id: "why", label: "Why we use it" },
  { id: "cookies", label: "Cookies and browser storage" },
  { id: "brenda", label: "Brenda and AI" },
  { id: "providers", label: "Services that process data for us" },
  { id: "transfers", label: "Where data is processed" },
  { id: "keep", label: "How long we keep it" },
  { id: "rights", label: "Your rights" },
  { id: "age", label: "Age" },
  { id: "security", label: "Security" },
  { id: "changes", label: "Changes and contact" },
];

const COOKIES: { name: string; purpose: string; lasts: string }[] = [
  { name: "boredroom_session", purpose: "Keeps you signed in.", lasts: "14 days" },
  { name: "boredroom_known", purpose: "Remembers, as a scrambled value, that an account has signed in on this browser, so a stranger guessing passwords elsewhere cannot lock you out.", lasts: "180 days" },
  { name: "boredroom_oauth", purpose: "Holds a sign-in with Google while Google sends you back.", lasts: "10 minutes" },
  { name: "boredroom_connector, boredroom_mcp", purpose: "Hold the connection of an app (a calendar, a tracker, a workspace app) while that app sends you back.", lasts: "10 minutes" },
  { name: "boredroom_desktop_auth, boredroom_from_desktop", purpose: "Hold a sign-in that started in Boredroom for Mac.", lasts: "Up to 30 minutes" },
  { name: "boredroom-shell", purpose: "Remembers whether you use Boredroom in the Mac app or the browser.", lasts: "1 year" },
];

const PROVIDERS: { who: string; does: string; gets: string; where: string }[] = [
  { who: "Vercel", does: "Runs the website and the app", gets: "Everything you send to Boredroom passes through it, with your IP address", where: "United States" },
  { who: "Neon", does: "Database", gets: "Accounts and all workspace records", where: "United States" },
  { who: "Fly.io", does: "Runs background work (reminders, reports, scans)", gets: "The workspace records that work needs", where: "United States" },
  { who: "Cloudflare (R2)", does: "File storage", gets: "Files you upload, voice notes in messages and profile pictures", where: "Western Europe" },
  { who: "Anthropic", does: "The AI model behind Brenda", gets: "What you ask Brenda and the workspace information she needs to answer; a screenshot or page text only when you ask her to look", where: "United States" },
  { who: "ElevenLabs", does: "Turns speech into text and gives Brenda her voice", gets: "Audio you dictate; the text Brenda speaks", where: "United States" },
  { who: "LiveKit", does: "Carries calls", gets: "The sound and video of a call while it is live, to reach the people on it. Nothing is recorded", where: "Outside Nigeria" },
  { who: "Brevo", does: "Sends email and holds the mailing list", gets: "The emails we send you and the address they go to. If you asked for product news or joined the waitlist: your name, organisation, plan, sign-up date and when you were last active", where: "European Union" },
  { who: "Resend", does: "Receives email sent to boredroom.cc addresses", gets: "The email you send us", where: "United States" },
  { who: "Paystack", does: "Takes payments", gets: "The payer's email address, the amount, the organisation and the plan. Card details go to Paystack, never to us", where: "Nigeria" },
  { who: "Google", does: "Sign in with Google, if you choose it", gets: "Google tells us your name, email address and profile picture", where: "United States" },
];

const KEPT: { what: string; long: string }[] = [
  { what: "Your account and profile", long: "Until the account is deleted" },
  { what: "Workspace records (tasks, timesheets, attendance, messages, documents, files, reports, the activity log)", long: "Until the organisation deletes them or closes the workspace" },
  { what: "Sign-in records, with IP address", long: "While the account exists" },
  { what: "Sign-in sessions (browser type, last seen)", long: "While the account exists" },
  { what: "Attempt counters that hold an IP address (sign-in, sign-up, recovery, waitlist, demo requests)", long: "1 day" },
  { what: "Sign-in and recovery links", long: "7 days after they expire" },
  { what: "Call transcripts made for Brenda's notes", long: "7 days after the recap" },
  { what: "Brenda for Mac's jobs and requests", long: "30 days" },
  { what: "Research reports", long: "90 days" },
  { what: "Items read from connected apps", long: "7 to 30 days after they are gone or closed there" },
  { what: "Screenshots and page text Brenda looked at", long: "Not kept" },
  { what: "Audio you dictate", long: "Not kept" },
  { what: "Payment records", long: "As long as tax and accounting law requires" },
  { what: "Waitlist and mailing-list details", long: "Until you unsubscribe and ask us to delete them" },
];

export default function PrivacyPage() {
  const mail = <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;
  return (
    <>
      <ArticleHeader path={PATH} lead={<p>What Boredroom collects, why, who can see it and how long it is kept. In force from {formatDate(LEGAL_VERSION)}.</p>} />
      <ArticleBody toc={TOC}>
        <h2 id="who">Who we are</h2>
        <p>Boredroom is operated by {legalName()}, {legalAddress()} (&ldquo;Boredroom&rdquo;, &ldquo;we&rdquo;). This policy covers boredroom.cc, the Boredroom app, Boredroom for Mac and the Brenda browser helper.</p>
        <p>There are two kinds of data, and who is responsible differs:</p>
        <ul>
          <li><strong>Your account, billing and our emails to you.</strong> We decide how this is used and are responsible for it.</li>
          <li><strong>Work inside a workspace.</strong> The organisation that owns the workspace (usually your employer) decides what is recorded and who sees it. We hold that data on its behalf and follow its instructions. Questions about it go to the organisation first.</li>
        </ul>
        <p>For anything about your personal data, write to {mail}.</p>

        <h2 id="collect">What we collect</h2>
        <h3>When you create an account</h3>
        <ul>
          <li>Your name, email address and a password, which we store only as a one-way hash.</li>
          <li>If you sign in with Google: your Google account&apos;s name, email address and profile picture. The picture is copied once and becomes your Boredroom picture; you can change or remove it.</li>
          <li>The date and version of these terms you agreed to, and whether you asked for product news.</li>
        </ul>
        <h3>Your IP address and device</h3>
        <ul>
          <li><strong>IP address.</strong> We record it when you sign up, sign in, ask for a password reset, join the waitlist, ask for a demo or connect the Mac app. It is used to stop password guessing and abuse, and to investigate misuse of an account.</li>
          <li><strong>Browser and device.</strong> The type of browser you signed in with, when each sign-in started and was last active, and the name of any Mac you connect.</li>
        </ul>
        <h3>What you do in a workspace</h3>
        <ul>
          <li><strong>Work you record:</strong> to-dos, tasks, progress notes, files you submit, documents, standup updates and end-of-day reports.</li>
          <li><strong>Time:</strong> when you clock in and out (including whether that was late or early against your schedule), and the timers you start, pause and stop. While a timer you started is running, your browser tells us every 30 seconds that it is still connected.</li>
          <li><strong>Messages:</strong> what you write and the voice notes you send, in direct messages and channels.</li>
          <li><strong>Your status:</strong> active, away, busy or offline, as you set it.</li>
          <li><strong>An activity log:</strong> a record of actions taken in the workspace (for example, who approved a timesheet or changed a role), with the time and the person.</li>
          <li><strong>Commitments:</strong> if your organisation switches it on, Brenda reads group chats (never direct messages) to note promises people make, such as &ldquo;I&apos;ll send it Thursday&rdquo;.</li>
        </ul>
        <h3>Calls</h3>
        <p>Calls are never recorded. If someone turns on Brenda&apos;s notes, each person chooses whether to be included. The words of those who agree are written down on their own device and only the text reaches us.</p>
        <h3>Payments</h3>
        <p>Payments are taken by Paystack. We never see or store a full card number. We keep the payment reference, amount, plan, the payer&apos;s email address and the summary Paystack returns (such as the card type and its last four digits).</p>
        <h3>Waitlist and product news</h3>
        <p>If you join the waitlist we keep what you enter: name, email address, company, company size and role. We send product news only to people on the waitlist and people who ticked the box asking for it. Every such email has an unsubscribe link.</p>
        <h3>Demo requests</h3>
        <p>If you ask for a demo we keep what you enter (name, email address, company, team size, role, the times that suit you and your note) and your browser&apos;s time zone, and use them to arrange the demo. Asking for a demo does not add you to product news.</p>
        <h3>Apps your organisation connects</h3>
        <p>If you or your organisation connect a calendar or work tracker (for example Google Calendar, Outlook, Slack, Notion, Linear, Jira, GitHub or Asana), Boredroom reads the items needed to show and act on them, with the permissions you approve there.</p>

        <h2 id="never">What we never collect</h2>
        <ul>
          <li>No screen recording and no call recording.</li>
          <li>No keystrokes, mouse movement, or list of the apps and websites you use.</li>
          <li>No productivity score.</li>
          <li>No advertising or analytics trackers, and no session-replay tools. Our pages load no third-party scripts and our fonts are served from our own site.</li>
          <li>We do not sell personal data.</li>
          <li>Profile pictures are shown as pictures only. We do not use them to recognise or identify anyone.</li>
        </ul>

        <h2 id="see">Who can see your data</h2>
        <ScrollTable label="Who can see what">
          <table>
            <thead><tr><th scope="col">Who</th><th scope="col">What they can see</th></tr></thead>
            <tbody>
              <tr><th scope="row">You</th><td>Everything of your own. Your chats with Brenda and what she does on your Mac are visible to you alone.</td></tr>
              <tr><th scope="row">People you message</th><td>The messages and voice notes in conversations they are part of.</td></tr>
              <tr><th scope="row">Your team lead</th><td>Their team&apos;s tasks, timers, clock-ins, timesheets, standups and end-of-day reports.</td></tr>
              <tr><th scope="row">The owner and HR</th><td>The same for the whole organisation, and its activity log.</td></tr>
              <tr><th scope="row">Boredroom support staff</th><td>Account details, sign-in records (with IP address and browser type), and work activity such as the task a timer is running on and clock-in times. They do not read your messages in the course of their work. To fix a problem they can open a workspace as one of its members for up to two hours, and then see what that member sees; a reason is recorded and the workspace&apos;s activity log marks what was done as Boredroom support.</td></tr>
            </tbody>
          </table>
        </ScrollTable>
        <p>Your organisation cannot see your IP address, the screenshots Brenda looks at, or whether you used her Look feature.</p>

        <h2 id="why">Why we use it</h2>
        <ScrollTable label="Purposes and legal grounds">
          <table>
            <thead><tr><th scope="col">Purpose</th><th scope="col">Legal ground</th></tr></thead>
            <tbody>
              <tr><th scope="row">Running your account and the workspace features</th><td>Our contract with you and with your organisation</td></tr>
              <tr><th scope="row">Keeping accounts safe: sign-in records, IP addresses, attempt limits</th><td>Our legitimate interest in security and preventing abuse</td></tr>
              <tr><th scope="row">Emails about your account, security and billing</th><td>Contract</td></tr>
              <tr><th scope="row">Product news</th><td>Your consent, which you can withdraw at any time</td></tr>
              <tr><th scope="row">Brenda&apos;s call notes; Brenda looking at your screen or a web page</th><td>Your consent, each time</td></tr>
              <tr><th scope="row">Payment and tax records</th><td>Legal obligation</td></tr>
            </tbody>
          </table>
        </ScrollTable>
        <p>We do not make decisions about you by automated means alone. Brenda drafts, reminds and suggests; people decide.</p>

        <h2 id="cookies">Cookies and browser storage</h2>
        <p>Boredroom uses only the cookies it needs to work. None are for advertising or analytics, and none come from another company, so there is nothing to switch off: without them you could not sign in.</p>
        <ScrollTable label="Cookies">
          <table>
            <thead><tr><th scope="col">Cookie</th><th scope="col">What it is for</th><th scope="col">Lasts</th></tr></thead>
            <tbody>
              {COOKIES.map((c) => <tr key={c.name}><th scope="row"><code>{c.name}</code></th><td>{c.purpose}</td><td>{c.lasts}</td></tr>)}
            </tbody>
          </table>
        </ScrollTable>
        <p>Your browser also keeps a few preferences on your device: light or dark theme, whether the sidebar is open, sound and voice settings, and, if you use on-device dictation, the speech model it downloaded. These stay in your browser.</p>

        <h2 id="brenda">Brenda and AI</h2>
        <ul>
          <li><strong>Answers.</strong> What you ask Brenda, and the workspace information she needs to answer, is sent to Anthropic&apos;s AI model to produce the reply. She reads only what your role already lets you see.</li>
          <li><strong>Looking at your screen (Brenda for Mac).</strong> Only when you hold her keys or press Look. One picture is sent to produce the answer and is not kept, by us or on your Mac. She never looks at password managers, at apps you or your organisation have excluded, or during a call or screen share.</li>
          <li><strong>Working in Chrome.</strong> The browser helper works only in its own &ldquo;Brenda&rdquo; tab group and never reads your other tabs. It reads the text of the page it is working on, never types into or reads password, card, PIN or one-time-code fields, and asks before anything that sends, buys or deletes.</li>
          <li><strong>Voice.</strong> Audio you dictate is sent to be written out and is not kept. If that service is unavailable, dictation runs on your own device; in some browsers the browser&apos;s own speech service (in Chrome, Google&apos;s) may be used instead.</li>
          <li><strong>Research.</strong> When you ask Brenda to research something, your question is used to search and read public web pages.</li>
        </ul>

        <h2 id="providers">Services that process data for us</h2>
        <p>These companies process personal data for us, under contract, only to provide the service named.</p>
        <ScrollTable label="Service providers">
          <table>
            <thead><tr><th scope="col">Company</th><th scope="col">What it does</th><th scope="col">What it receives</th><th scope="col">Where</th></tr></thead>
            <tbody>
              {PROVIDERS.map((p) => <tr key={p.who}><th scope="row">{p.who}</th><td>{p.does}</td><td>{p.gets}</td><td>{p.where}</td></tr>)}
            </tbody>
          </table>
        </ScrollTable>
        <p>Downloading the Mac app&apos;s updates (from GitHub) or the on-device speech model (from Hugging Face) shows those services your IP address, as any download does. Apps your organisation connects, and any tools it adds for Brenda, receive what is needed to carry out what you ask of them.</p>
        <p>We may also disclose data when the law requires it, or to a buyer if the business is sold, under the same protections.</p>

        <h2 id="transfers">Where data is processed</h2>
        <p>Most of these services are outside Nigeria, mainly in the United States and the European Union. Where data leaves Nigeria we rely on the provider&apos;s contractual data-protection commitments and, where needed, your consent, as the Nigeria Data Protection Act allows.</p>

        <h2 id="keep">How long we keep it</h2>
        <ScrollTable label="Retention">
          <table>
            <thead><tr><th scope="col">Data</th><th scope="col">Kept for</th></tr></thead>
            <tbody>
              {KEPT.map((k) => <tr key={k.what}><th scope="row">{k.what}</th><td>{k.long}</td></tr>)}
            </tbody>
          </table>
        </ScrollTable>
        <p>When you ask us to delete your account we delete or anonymise your personal data within 30 days, except what the law requires us to keep and work records that belong to your organisation.</p>

        <h2 id="rights">Your rights</h2>
        <p>Under the Nigeria Data Protection Act you can:</p>
        <ul>
          <li>ask what data we hold about you and get a copy;</li>
          <li>have wrong data corrected;</li>
          <li>have your data deleted;</li>
          <li>object to, or ask us to limit, how we use it;</li>
          <li>receive your data in a form you can take elsewhere;</li>
          <li>withdraw a consent you gave, such as product news or call notes.</li>
        </ul>
        <p>Write to {mail}. We answer within 30 days and may ask you to confirm who you are. For work data in a workspace, ask your organisation first; we will help it respond.</p>
        <p>If you are not satisfied with our answer, you can complain to the Nigeria Data Protection Commission (ndpc.gov.ng).</p>

        <h2 id="age">Age</h2>
        <p>Boredroom is a workplace tool for adults. You must be {MINIMUM_AGE} or older to create an account, and you confirm this when you sign up. We do not knowingly collect data from anyone under {MINIMUM_AGE}; if we learn that we have, we delete the account.</p>

        <h2 id="security">Security</h2>
        <ul>
          <li>Connections to Boredroom are encrypted.</li>
          <li>Passwords are stored only as one-way hashes.</li>
          <li>Each organisation&apos;s records are kept apart from every other&apos;s in the database.</li>
          <li>Files are in private storage and are opened only through short-lived links from the app.</li>
          <li>Keys for connected apps are encrypted before they are stored.</li>
        </ul>
        <p>No service can promise perfect security. If a breach puts your data at risk we will tell you and the Commission as the law requires.</p>

        <h2 id="changes">Changes and contact</h2>
        <p>If we change this policy in a way that matters, we will email account holders before it takes effect and update the date above. The agreement for using Boredroom is in the <Link href="/terms">Terms of Service</Link>.</p>
        <p>{legalName()}<br />{legalAddress()}<br />{mail}</p>
      </ArticleBody>
    </>
  );
}

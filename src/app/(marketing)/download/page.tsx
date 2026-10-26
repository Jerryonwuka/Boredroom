import Link from "next/link";
import { AppWindow, Cpu, Folder, KeyRound, Laptop, Mic, MousePointerClick, RefreshCw, ScreenShare, UserRound, Video } from "lucide-react";
import { heroButton } from "@/components/landing/hero";
import { WRAP } from "@/components/landing/parts";
import { PlatformNote } from "@/components/marketing/download/platform-note";
import { CardGrid } from "@/components/marketing/card-grid";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { StepGrid } from "@/components/marketing/step-grid";
import { HeroCluster, NotchMock } from "@/components/marketing/visuals";
import { desktopDownloadUrl, MAC_REQUIREMENTS } from "@/lib/desktop-download";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ORGANIZATION, SOFTWARE_APPLICATION, ref, type JsonLdNode } from "@/lib/marketing/schema";
import { absoluteUrl } from "@/lib/marketing/site";

/**
 * /download: Boredroom for Mac (owner request, 24 October 2026: people download it and set up the notch before there is
 * an Apple Developer account; option A, the same day: one app, Boredroom.app, with the dashboard in its own window and
 * Brenda in its notch, and one sign-in for both). The disk image from the public releases repo (DESKTOP_DOWNLOAD_URL, or the releases default;
 * "off" stops offering it), what a Mac needs, the first-open steps an app not yet signed by Apple needs on current
 * macOS (open it, Done, Privacy & Security, Open Anyway, Open), signing in once, what it asks the Mac for (each only
 * when the person turns it on; the words follow desktop/README.md), how updates arrive, and the questions.
 * A visitor who isn't on a Mac is told so (PlatformNote); the button stays, since people send the link to their Mac.
 *
 * The product page template (pages v2): a split hero with the notch, then hairline cards and numbered steps.
 */
const PATH = "/download";
export const metadata = pageMetadata(PATH);

/** The disk image's size, rounded, from the 0.2.0 build (desktop/scripts/release.mjs prints it each release). */
const DMG_SIZE = "about 15 MB";

const FAQ = [
  {
    question: "Why does macOS say it can't check Boredroom?",
    answer: "This early version of Boredroom for Mac isn't signed and notarised by Apple yet, so macOS asks you to confirm once that you want to open it. A version signed by Apple is coming, and then the extra steps go. Download Boredroom for Mac only from boredroom.cc.",
  },
  {
    question: "Does Boredroom for Mac work on Intel Macs?",
    answer: "Yes. One download runs on Apple silicon and on Intel Macs, with macOS 14 Sonoma or later.",
  },
  {
    question: "Is there a Windows version?",
    answer: "Boredroom for Windows is coming. Until then, Boredroom and Brenda work in your browser, on any computer.",
  },
  {
    question: "Why does Google sign-in open my browser?",
    answer: "Google doesn't allow signing in inside apps' own windows, so Boredroom opens your browser for it and comes back when you're done. Connecting Slack, Notion, GitHub and other apps works the same way.",
  },
  {
    question: "How do I remove Boredroom for Mac?",
    answer: "Choose Sign out of Boredroom in its menu in the menu bar, or remove the Mac in Boredroom under Settings › Desktop. Then choose Quit Boredroom and drag Boredroom from Applications to the Bin.",
  },
] as const;

/** Boredroom for Mac as its own application, next to Boredroom's (the hero's graph has the WebPage and the breadcrumbs). */
function macAppJsonLd(downloadUrl: string | null): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": `${absoluteUrl(PATH)}#app`,
    name: "Boredroom for Mac",
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS 14 or later",
    description: "Your Boredroom dashboard in its own Mac window, and Brenda, the Boredroom assistant, in your Mac's notch: ask her something, see reminders and calls as they arrive and let her help on this Mac when you say so.",
    url: absoluteUrl(PATH),
    ...(downloadUrl ? { downloadUrl } : {}),
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: ref(ORGANIZATION),
    isRelatedTo: ref(SOFTWARE_APPLICATION),
  };
}

export default function DownloadPage() {
  const url = desktopDownloadUrl();
  return (
    <>
      <ProductHero path={PATH} jsonLd={[macAppJsonLd(url)]}
        lead={<p>Boredroom for Mac puts your dashboard in its own window and Brenda in your Mac&apos;s notch. Hold Option and Space to ask her something, see reminders and calls as they come, and let her help on this Mac when you say so.</p>}
        sub={<p>Free, for {MAC_REQUIREMENTS.macos} on {MAC_REQUIREMENTS.chips}. One download runs on both. The first time you open it, macOS asks you to confirm once in Privacy &amp; Security: <a href="#first-open">see the steps</a>.</p>}
        actions={url ? (
          <>
            <a href={url} className={heroButton("primary")}>Download for Mac</a>
            <Link href="/desktop/link" className={heroButton("secondary")}>Already installed? Link with a code</Link>
          </>
        ) : (
          <>
            <p className="lp-text">Boredroom for Mac isn&apos;t available to download right now.</p>
            <Link href="/desktop/link" className={heroButton("secondary")}>Already installed? Link with a code</Link>
          </>
        )}
        visual={<HeroCluster primary={<NotchMock />} caption={<>The notch with Brenda: the timer and the morning briefing.</>} />}
      />
      <div className={WRAP}>
        <PlatformNote className="mt-6 max-w-xl" />
      </div>

      <Section id="requirements" label="Requirements" title="What your Mac needs">
        <CardGrid columns={3} items={[
          { icon: <Laptop />, title: MAC_REQUIREMENTS.macos, body: <p>Boredroom for Mac runs on macOS 14 Sonoma, 15 Sequoia and later. Seeing your screen when you ask needs macOS 14 too.</p> },
          { icon: <Cpu />, title: MAC_REQUIREMENTS.chips, body: <p>One download runs on Apple silicon and on Intel Macs. The download is {DMG_SIZE}; turning voice on downloads a 148 MB speech model once, so what you say is turned into text on your Mac.</p> },
          { icon: <UserRound />, title: "A Boredroom account", body: <p>Sign in once: the window shows your dashboard, and the notch your Brenda, your reminders and your asks.</p> },
        ]} />
      </Section>

      <Section id="first-open" label="First time" title="Open Boredroom the first time" tone="tint"
        sub="This early version isn't signed by Apple yet, so macOS asks you to confirm once. A signed version is coming.">
        <StepGrid columns={3} steps={[
          { title: "Open the download", body: <p>Open Boredroom.dmg and drag Boredroom into Applications. Then open Boredroom from Applications.</p> },
          { title: "macOS stops it", body: <p>macOS says Boredroom wasn&apos;t opened because Apple couldn&apos;t check it for malware. Choose Done (or OK), not Move to Bin.</p> },
          { title: "Open Privacy & Security", body: <p>Open System Settings › Privacy &amp; Security and scroll down to Security.</p> },
          { title: "Choose Open Anyway", body: <p>Next to the line saying Boredroom was blocked, choose Open Anyway. The button shows for about an hour after step 2.</p> },
          { title: "Confirm once", body: <p>macOS asks once more: choose Open Anyway (Open on macOS 14), then enter your Mac&apos;s password or use Touch ID. You only do this once; updates arrive by themselves.</p> },
        ]} />
      </Section>

      <Section id="link" label="Sign in" title="Sign in once">
        <StepGrid columns={3} steps={[
          { title: "Open Boredroom", body: <p>The Boredroom window opens with the sign-in page the first time.</p> },
          { title: "Sign in", body: <p>Sign in with your email and password, or choose Continue with Google, which opens your browser and comes straight back. Brenda in your notch is signed in at the same time.</p> },
          { title: "That's it", body: <p>The dashboard is in its own window (in the Dock while it&apos;s open), and Brenda stays in your notch with the window closed. Prefer a code? Choose Use a code instead in the notch and approve it at <Link href="/desktop/link">boredroom.cc/desktop/link</Link>.</p> },
        ]} />
      </Section>

      <Section id="permissions" label="Permissions" title="What Boredroom asks your Mac for" tone="tint"
        sub="Each only when you turn it on. Nothing is on until you turn it on, and you can turn each off from Boredroom's menu in the menu bar.">
        <CardGrid columns={3} items={[
          { icon: <Mic />, title: "Microphone", body: <p>For hold to talk. She listens only while you hold the keys, and what you say is turned into text on your Mac.</p> },
          { icon: <ScreenShare />, title: "Screen & System Audio Recording", body: <p>For screen help: a picture of one screen, only when you hold Control and Command or press Look, where your organisation allows it. She never keeps what she sees.</p> },
          { icon: <MousePointerClick />, title: "Accessibility", body: <p>For doing things when you ask, step by step, with your yes first, and another yes for anything that sends, pays or deletes.</p> },
          { icon: <AppWindow />, title: "Automation › Finder", body: <p>To know which files you&apos;ve selected, and to empty the Bin only when you say yes.</p> },
          { icon: <Folder />, title: "Files and folders", body: <p>Documents, Desktop and Downloads, only for the files you ask her to work on.</p> },
          { icon: <Video />, title: "Camera and microphone in calls", body: <p>Only when you join a call in the Boredroom window and turn them on.</p> },
          { icon: <KeyRound />, title: "No password", body: <p>Boredroom keeps its sign-in on your Mac. Google and connected apps sign in through your browser.</p> },
        ]} />
      </Section>

      <Section id="updates" label="Updates" title="Updates arrive by themselves" width="text">
        <div className="lp-text mk-links max-w-3xl [&>*+*]:mt-4">
          <p className="flex items-start gap-3"><RefreshCw aria-hidden className="mt-1 size-4 shrink-0 text-secondary" /><span>Boredroom checks for updates once a day and downloads them quietly. When one is ready, the menu bar, the notch and the Boredroom menu offer Restart to update; it never restarts by itself. Every update is checked against Boredroom&apos;s signature before it is installed.</span></p>
          <p>While Boredroom for Mac isn&apos;t signed by Apple, macOS may ask you to allow the microphone, camera, screen recording or accessibility again after an update. If a switch in Privacy &amp; Security looks on but doesn&apos;t work, remove Boredroom from that list and add it again.</p>
        </div>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/features/ai-assistant", label: "Brenda, the AI assistant for teams" },
        { href: "/pricing", label: "Pricing" },
      ]} />
    </>
  );
}

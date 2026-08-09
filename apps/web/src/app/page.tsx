import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChartIcon,
  BookIcon,
  BowlIcon,
  ClockIcon,
  HandIcon,
  HeartIcon,
  NonInvasiveIcon,
  SparkleIcon,
  TargetIcon,
  TrendUpIcon,
  WifiRingsIcon,
} from "@/components/icons";
import NutriScoreGaugeCompact from "@/components/NutriScoreGaugeCompact";
import PhoneNutriScoreCard from "@/components/PhoneNutriScoreCard";
import ProgressChart from "@/components/ProgressChart";

const SUPPORTING_BENEFITS = [
  { icon: ClockIcon, label: "About 2 minutes" },
  { icon: NonInvasiveIcon, label: "Non-invasive" },
  { icon: TrendUpIcon, label: "Track progress over time" },
];

const WHY_PEOPLE_SCAN = [
  {
    icon: BowlIcon,
    title: "Eat well",
    body: "Choose healthy foods.",
  },
  {
    icon: HandIcon,
    title: "Quick scan",
    body: "A simple scan in about 2 minutes.",
  },
  {
    icon: TargetIcon,
    title: "Get your NutriScore",
    body: "See how your body is benefiting.",
  },
  {
    icon: TrendUpIcon,
    title: "Track progress",
    body: "Stay motivated and adjust as you go.",
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    icon: HandIcon,
    title: "Scan",
    body: "Place your hand on the scanner. A measurement takes about two minutes.",
  },
  {
    icon: SparkleIcon,
    title: "Measure",
    body: "NutriScan analyzes carotenoids stored in your skin using light.",
  },
  {
    icon: TrendUpIcon,
    title: "Improve",
    body: "Track your NutriScore over time to see how your habits may be reflected in your body.",
  },
];

const TRUST_PILLARS = [
  {
    icon: NonInvasiveIcon,
    title: "Non-invasive",
    body: "No needles. No blood draw. Just a quick scan.",
  },
  {
    icon: WifiRingsIcon,
    title: "Optical measurement",
    body: "Measures carotenoids stored in the skin using light.",
  },
  {
    icon: BookIcon,
    title: "Research-based",
    body: "Built on published research into skin carotenoid measurement.",
  },
];

const LEFT_COLLAGE_PHOTOS = [
  { src: "/lifestyle-mountain.jpg", alt: "Woman relaxing on a mountain overlook at sunrise" },
  { src: "/lifestyle-chopping.jpg", alt: "Woman chopping fresh vegetables in her kitchen" },
  { src: "/lifestyle-wellness.jpg", alt: "Water bottle, yoga mat, and dumbbells" },
  { src: "/lifestyle-capsules.jpg", alt: "Hand holding a few supplement capsules" },
];

const RIGHT_COLLAGE_PHOTOS = [
  { src: "/lifestyle-smoothie.jpg", alt: "Woman drinking a green smoothie" },
  { src: "/lifestyle-bowl.jpg", alt: "Colorful buddha bowl with avocado and vegetables" },
  { src: "/lifestyle-family.jpg", alt: "Family eating a meal together" },
  { src: "/lifestyle-scanner.jpg", alt: "NutriScan scanner with spinach and blueberries" },
];

const LIFESTYLE_PILLARS = [
  {
    icon: NonInvasiveIcon,
    title: "Small choices",
    body: "Simple, sustainable changes that fit your life.",
  },
  {
    icon: HeartIcon,
    title: "Better habits",
    body: "Build routines that support your health.",
  },
  {
    icon: BarChartIcon,
    title: "Real results",
    body: "Track your progress and see the difference.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-col">
      {/* 1. Hero */}
      <section aria-labelledby="hero-heading" className="px-6 pb-20 pt-14 sm:pb-28 sm:pt-20">
        <div className="mx-auto grid max-w-6xl gap-14 md:grid-cols-2 md:items-center md:gap-10 lg:gap-16">
          <div>
            <h1
              id="hero-heading"
              className="max-w-xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
            >
              Healthy eating shouldn’t be guesswork.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-600">
              See how your fruit and vegetable habits are reflected in your
              body with a quick, non-invasive scan.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
              <Link
                href="/scan/welcome"
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-7 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md"
              >
                Begin Scan
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-1 text-base font-medium text-emerald-700 hover:text-emerald-800"
              >
                How it works
                <ArrowRightIcon className="h-4 w-4" />
              </a>
            </div>

            <ul className="mt-12 flex flex-wrap gap-x-8 gap-y-3 border-t border-slate-100 pt-6 text-sm text-slate-500">
              {SUPPORTING_BENEFITS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-emerald-700" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Desktop/tablet hero visual */}
          <div className="relative hidden md:block">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl shadow-xl shadow-slate-900/10">
              <Image
                src="/scanner-hero.jpg"
                alt="NutriScan scanner device with a hand resting on it"
                fill
                priority
                className="object-cover"
                sizes="(min-width: 768px) 50vw, 100vw"
              />
            </div>
            {/* Sibling to (not nested in) the overflow-hidden image wrapper above,
                so this can overhang the photo's top-right corner without being clipped. */}
            <PhoneNutriScoreCard className="absolute -top-8 right-4 w-40 rotate-3 lg:w-44 xl:w-48" />
          </div>

          {/* Mobile hero visual */}
          <div className="relative mx-auto mt-2 w-full max-w-xs sm:max-w-sm md:hidden">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl shadow-lg shadow-slate-900/10">
              <Image
                src="/scanner-hero.jpg"
                alt="NutriScan scanner device with a hand resting on it"
                fill
                priority
                className="object-cover"
                sizes="(min-width: 640px) 384px, 100vw"
              />
            </div>
            <PhoneNutriScoreCard
              variant="flat"
              className="relative z-10 mx-auto -mt-10 w-52"
            />
          </div>
        </div>
      </section>

      {/* 2. Why people scan */}
      <section
        aria-labelledby="why-scan-heading"
        className="border-y border-emerald-100 bg-emerald-50/70 px-6 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2
            id="why-scan-heading"
            className="text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
          >
            Why people scan
          </h2>
          <div className="mt-14 flex flex-col items-stretch gap-8 sm:mt-16 md:flex-row md:items-start md:justify-between md:gap-4">
            {WHY_PEOPLE_SCAN.map(({ icon: Icon, title, body }, index) => (
              <div key={title} className="flex flex-col items-center gap-4 md:contents">
                <div className="flex flex-1 flex-col items-center text-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">
                    {title}
                  </h3>
                  <p className="mt-1.5 max-w-[10rem] text-xs leading-relaxed text-slate-600">
                    {body}
                  </p>
                </div>
                {index < WHY_PEOPLE_SCAN.length - 1 && (
                  <ArrowRightIcon className="h-4 w-4 shrink-0 rotate-90 text-emerald-300 md:mt-3.5 md:rotate-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5/6/7 (visual grouping). How it works / Your NutriScore / See progress over time */}
      <section
        id="how-it-works"
        aria-label="How it works, your NutriScore, and progress over time"
        className="px-6 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-3">
            {/* How it works */}
            <div className="flex flex-col border-b border-slate-200 p-8 lg:border-b-0 lg:border-r lg:p-10">
              <h3 className="text-lg font-semibold text-slate-900">
                How it works
              </h3>
              <div className="mt-6 flex flex-1 flex-col justify-center gap-6">
                {HOW_IT_WORKS_STEPS.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        {title}
                      </h4>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        {body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Your NutriScore — the visual focus of the three cards */}
            <div className="relative flex flex-col border-b border-slate-200 bg-gradient-to-b from-emerald-50/70 to-white p-8 lg:border-b-0 lg:border-r lg:p-10">
              <h3 className="text-lg font-semibold text-slate-900">
                Your NutriScore
              </h3>
              <div className="mt-6 flex flex-1 flex-col items-center gap-6 sm:flex-row sm:items-center lg:flex-col lg:justify-center xl:flex-row">
                <NutriScoreGaugeCompact score={85} delta={4} size={200} />
                <div className="text-center sm:text-left lg:text-center xl:text-left">
                  <p className="text-sm leading-relaxed text-slate-600">
                    Strong carotenoid status — consistent with a diet rich in
                    colorful fruits and vegetables.
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100">
                    <span className="font-semibold text-emerald-700">+4</span>
                    <span className="text-slate-600">
                      Compared to your last scan
                    </span>
                  </span>
                </div>
              </div>
              <a
                href="#"
                className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                Learn more about your score
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* See progress over time */}
            <div id="progress" className="flex flex-col p-8 lg:p-10">
              <h3 className="text-lg font-semibold text-slate-900">
                See progress over time
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Small changes today can lead to big results tomorrow.
              </p>
              <div className="mt-6 flex flex-1 items-center">
                <ProgressChart />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Trust section */}
      <section
        id="science"
        aria-labelledby="science-heading"
        className="border-t border-slate-100 px-6 py-16 sm:py-20"
      >
        <h2 id="science-heading" className="sr-only">
          Science and trust
        </h2>
        <div className="mx-auto flex max-w-5xl flex-col gap-10 sm:flex-row sm:justify-between sm:gap-8">
          {TRUST_PILLARS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-1 flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. Final CTA */}
      <section
        aria-labelledby="final-cta-heading"
        className="border-t border-emerald-100 bg-emerald-50/40 px-6 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 md:grid-cols-3 md:items-center md:gap-8 lg:gap-12">
            <div className="order-2 grid grid-cols-2 gap-3 sm:gap-4 md:order-1">
              {LEFT_COLLAGE_PHOTOS.map(({ src, alt }) => (
                <div
                  key={src}
                  className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-sm shadow-slate-900/5"
                >
                  <Image
                    src={src}
                    alt={alt}
                    fill
                    className="object-cover"
                    sizes="(min-width: 768px) 18vw, 45vw"
                  />
                </div>
              ))}
            </div>

            <div className="order-1 mx-auto flex max-w-sm flex-col items-center text-center md:order-2">
              <h2
                id="final-cta-heading"
                className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl"
              >
                A healthier you, every day
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Better habits. Better choices. Better results.
              </p>
              <Link
                href="/scan/welcome"
                className="mt-9 inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-8 py-3.5 text-base font-semibold text-white shadow-sm ring-1 ring-emerald-700/10 transition-all hover:bg-emerald-800 hover:shadow-md"
              >
                Begin Scan
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>

            <div className="order-3 grid grid-cols-2 gap-3 sm:gap-4">
              {RIGHT_COLLAGE_PHOTOS.map(({ src, alt }) => (
                <div
                  key={src}
                  className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-sm shadow-slate-900/5"
                >
                  <Image
                    src={src}
                    alt={alt}
                    fill
                    className="object-cover"
                    sizes="(min-width: 768px) 18vw, 45vw"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-20 grid gap-8 border-t border-emerald-100 pt-14 sm:grid-cols-3 sm:gap-6">
            {LIFESTYLE_PILLARS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 py-10">
        <div className="mx-auto max-w-6xl text-center text-sm text-slate-400">
          NutriScan
        </div>
      </footer>
    </main>
  );
}

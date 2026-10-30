import { Button } from "@/components/ui/button"

export function Hero() {
  return (
    <section className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
        Hello Tools
      </h1>
      <p className="max-w-md text-muted-foreground">
        A collection of tools that run entirely in your browser.
      </p>
      <Button size="lg">Get started</Button>
    </section>
  )
}

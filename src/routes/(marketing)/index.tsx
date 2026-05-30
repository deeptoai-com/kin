import { Link, createFileRoute } from '@tanstack/react-router';
import { useIntlayer } from 'react-intlayer';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Code2,
  Database,
  Palette,
  Cpu,
  Zap,
  Box,
  GitBranch,
  BarChart3,
} from 'lucide-react';
import GradientOrb from '~/components/gradient-orb';

export const Route = createFileRoute('/(marketing)/')({
  component: RouteComponent,
});

function RouteComponent() {
  const content = useIntlayer('marketing');

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Hero Section */}
      <section className="container relative z-0 mx-auto flex flex-col items-center px-4 pt-20 pb-16 text-center md:pt-32 md:pb-24">
        <GradientOrb className="-translate-x-1/2 absolute top-0 left-1/2 z-[-1] transform" />

        <Badge variant="secondary" className="mb-4 px-4 py-1">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {content.hero.badge}
        </Badge>

        <h1 className="max-w-4xl font-bold text-4xl text-foreground md:text-6xl lg:text-7xl">
          {content.hero.title}
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          {content.hero.subtitle}
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <Button size="lg" asChild className="rounded-full px-8">
            <Link to="/agents/claude-chat">
              {content.hero.primaryButton} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="rounded-full px-8" asChild>
            <a
              href="https://github.com/foreveryh/oxygenie"
              target="_blank"
              rel="noopener noreferrer"
            >
              {content.hero.secondaryButton}
            </a>
          </Button>
        </div>

        <p className="mt-8 text-muted-foreground text-sm">
          {content.hero.poweredBy}{' '}
          <a
            href="https://open.bigmodel.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {content.hero.poweredByLine}
          </a>
        </p>
      </section>

      {/* Core Features Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {content.features.title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {content.features.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {/* DeeptoAI Agent Chat */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <MessageSquare className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.deeptoaiChat.title}</CardTitle>
              <CardDescription>
                {content.features.deeptoaiChat.description}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Skills Store */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <Box className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.skillsStore.title}</CardTitle>
              <CardDescription>
                {content.features.skillsStore.description}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Artifacts */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <GitBranch className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.artifacts.title}</CardTitle>
              <CardDescription>
                {content.features.artifacts.description}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Knowledge Base */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <Database className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.knowledgeBase.title}</CardTitle>
              <CardDescription>
                {content.features.knowledgeBase.description}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Session Management */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <GitBranch className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.sessionManagement.title}</CardTitle>
              <CardDescription>
                {content.features.sessionManagement.description}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Tool Visualization */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <Cpu className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{content.features.toolVisualization.title}</CardTitle>
              <CardDescription>
                {content.features.toolVisualization.description}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {content.techStack.title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {content.techStack.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                {content.techStack.claudeChat.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.claudeChat.claudeAgentSDK}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.claudeChat.zhipuAi}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.claudeChat.websocket}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.claudeChat.assistantUi}
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                {content.techStack.additionalFeatures.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.additionalFeatures.mastraAiChat}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.additionalFeatures.betterAuth}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.additionalFeatures.postgresql}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {content.techStack.additionalFeatures.shadcn}
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Architecture Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {content.architecture.title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {content.architecture.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <Badge className="mb-2 w-fit">{content.architecture.deeptoai.badge}</Badge>
              <CardTitle className="text-xl">{content.architecture.deeptoai.title}</CardTitle>
              <CardDescription className="text-base">
                {content.architecture.deeptoai.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• {content.architecture.deeptoai.feature1}</li>
                <li>• {content.architecture.deeptoai.feature2}</li>
                <li>• {content.architecture.deeptoai.feature3}</li>
                <li>• {content.architecture.deeptoai.feature4}</li>
                <li>• {content.architecture.deeptoai.feature5}</li>
                <li>• {content.architecture.deeptoai.feature6}</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Badge variant="secondary" className="mb-2 w-fit">{content.architecture.mastra.badge}</Badge>
              <CardTitle className="text-xl">{content.architecture.mastra.title}</CardTitle>
              <CardDescription className="text-base">
                {content.architecture.mastra.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• {content.architecture.mastra.feature1}</li>
                <li>• {content.architecture.mastra.feature2}</li>
                <li>• {content.architecture.mastra.feature3}</li>
                <li>• {content.architecture.mastra.feature4}</li>
                <li>• {content.architecture.mastra.feature5}</li>
                <li>• {content.architecture.mastra.feature6}</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <Card className="mx-auto max-w-2xl border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center p-8 text-center md:p-12">
            <MessageSquare className="mb-4 h-12 w-12 text-primary" />
            <h2 className="mb-4 text-2xl font-bold md:text-3xl">
              {content.cta.title}
            </h2>
            <p className="mb-8 text-muted-foreground">
              {content.cta.subtitle}
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Button size="lg" className="rounded-full px-8" asChild>
                <Link to="/agents/claude-chat">
                  {content.cta.primaryButton} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-8" asChild>
                <Link to="/agents/skills">
                  <Box className="mr-2 h-4 w-4" />
                  {content.cta.secondaryButton}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="container mx-auto border-t px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-center text-sm text-muted-foreground">
            {content.footer.copyright}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            <a
              href="https://github.com/foreveryh/oxygenie"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {content.footer.github}
            </a>
            {' '}&bull;{' '}
            <a
              href="https://github.com/anthropics/claude-agent-kit"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {content.footer.claudeAgentSDK}
            </a>
            {' '}&bull;{' '}
            <a
              href="https://open.bigmodel.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {content.footer.zhipuAi}
            </a>
            {' '}&bull;{' '}
            <a
              href="https://assistant-ui.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {content.footer.assistantUi}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { OnboardingStepGuard } from "../components/OnboardingStepGuard";
import {
  ProfilingStep,
  ProfilingStepLoading,
  ProfilingStepUnavailable,
} from "../components/project-setup/ProfilingStep";
import { useProfilingQuestionnaire } from "../hooks/useProfilingQuestionnaire";
import {
  advanceOnboardingStep,
  getOnboardingAvatarId,
} from "../lib/onboarding";
import { useEffect, useState } from "react";

function OnboardingProfilingContent() {
  const navigate = useNavigate();
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function resolveAvatar() {
      try {
        const id = await getOnboardingAvatarId();
        if (!id) {
          throw new Error(
            "Onboarding avatar is missing. Return to project setup and try again.",
          );
        }
        if (isMounted) {
          setAvatarId(id);
        }
      } catch (error) {
        if (isMounted) {
          setResolveError(
            error instanceof Error
              ? error.message
              : "Failed to load onboarding avatar.",
          );
        }
      } finally {
        if (isMounted) {
          setResolving(false);
        }
      }
    }

    void resolveAvatar();
    return () => {
      isMounted = false;
    };
  }, []);

  const {
    avatar,
    questions,
    questionIndex,
    answers,
    errorMessage,
    fieldError,
    isLoading,
    isSaving,
    isSummarizing,
    setAnswer,
    goNext,
    goBack,
  } = useProfilingQuestionnaire({ avatarId });

  async function handleNext(answerOverride?: string) {
    const result = await goNext(answerOverride);
    if (result === "finished") {
      await advanceOnboardingStep("competitors");
      navigate("/onboarding/competitors", { replace: true });
    }
  }

  function handleBack() {
    const result = goBack();
    if (result === "exit") {
      navigate("/onboarding/project", { replace: true });
    }
  }

  if (resolving || isLoading) {
    return <ProfilingStepLoading />;
  }

  if (resolveError || !avatar || questions.length === 0) {
    return (
      <ProfilingStepUnavailable
        message={
          resolveError ?? errorMessage ?? "Profiling questions are unavailable."
        }
      />
    );
  }

  return (
    <ProfilingStep
      workspaceLabel={avatar.type}
      questions={questions}
      questionIndex={questionIndex}
      answers={answers}
      errorMessage={errorMessage}
      fieldError={fieldError}
      isSaving={isSaving}
      isSummarizing={isSummarizing}
      onAnswerChange={setAnswer}
      onNext={(answerOverride) => void handleNext(answerOverride)}
      onBack={handleBack}
    />
  );
}

export function OnboardingProfilingPage() {
  return (
    <OnboardingStepGuard expectedStep="profiling">
      <OnboardingProfilingContent />
    </OnboardingStepGuard>
  );
}

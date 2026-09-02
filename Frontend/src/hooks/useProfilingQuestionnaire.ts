import { useCallback, useEffect, useState } from "react";
import type { ProfilingQuestionDef } from "../config/onboardingProfilingQuestions";
import { fetchAvatar, type Avatar } from "../lib/avatars";
import {
  fetchProfilingQuestionnaire,
  firstUnansweredQuestionIndex,
  normalizeAnswerForSave,
  profilingDataToAnswers,
  upsertProfilingAnswer,
  validateProfilingAnswer,
} from "../lib/profiling";
import { summarizeProfiling } from "../lib/profileSummary";
import type { ProjectType } from "../types/contos";

export type UseProfilingQuestionnaireOptions = {
  avatarId: string | null;
  /** When set, use this type instead of loading from avatar (e.g. new project wizard). */
  projectType?: ProjectType | null;
  /** Start at question 0 even if answers exist (e.g. edit flow). */
  startAtBeginning?: boolean;
};

export function useProfilingQuestionnaire({
  avatarId,
  projectType = null,
  startAtBeginning = false,
}: UseProfilingQuestionnaireOptions) {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [questions, setQuestions] = useState<ProfilingQuestionDef[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const currentQuestion = questions[questionIndex] ?? null;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!avatarId) {
        if (isMounted) {
          setIsLoading(false);
          setErrorMessage(
            "Avatar is missing. Return to project setup and try again.",
          );
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loaded = await fetchAvatar(avatarId);
        const type = (projectType ?? loaded.type) as ProjectType;
        const questionnaire = await fetchProfilingQuestionnaire(type);
        const hydrated = profilingDataToAnswers(
          loaded.profiling_data,
          questionnaire,
        );
        const resumeIndex = startAtBeginning
          ? 0
          : firstUnansweredQuestionIndex(questionnaire, hydrated);

        if (!isMounted) {
          return;
        }

        setAvatar(loaded);
        setQuestions(questionnaire);
        setAnswers(hydrated);
        setQuestionIndex(resumeIndex);
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load profiling questionnaire.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [avatarId, projectType, startAtBeginning]);

  const setAnswer = useCallback((key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setFieldError(null);
  }, []);

  async function saveCurrentAnswer(answerOverride?: string): Promise<boolean> {
    if (!avatar || !currentQuestion) {
      return false;
    }

    const raw = answerOverride ?? answers[currentQuestion.key] ?? "";
    const validationError = validateProfilingAnswer(currentQuestion, raw);
    if (validationError) {
      setFieldError(validationError);
      return false;
    }

    setFieldError(null);
    setIsSaving(true);

    try {
      const normalized = normalizeAnswerForSave(currentQuestion, raw);
      const updated = await upsertProfilingAnswer(
        avatar.id,
        currentQuestion.key,
        normalized,
        {
          optional: !currentQuestion.required,
          questionText: currentQuestion.question,
        },
      );
      setAvatar(updated);
      setAnswers((current) => ({
        ...current,
        [currentQuestion.key]: normalized,
      }));
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save profiling answer.",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function goNext(
    answerOverride?: string,
  ): Promise<"advanced" | "finished" | "blocked"> {
    if (!currentQuestion || isSaving) {
      return "blocked";
    }

    setErrorMessage(null);
    if (answerOverride !== undefined) {
      setAnswers((current) => ({
        ...current,
        [currentQuestion.key]: answerOverride,
      }));
    }
    const saved = await saveCurrentAnswer(answerOverride);
    if (!saved) {
      return "blocked";
    }

    if (questionIndex < questions.length - 1) {
      setQuestionIndex((index) => index + 1);
      return "advanced";
    }

    if (avatarId) {
      setIsSummarizing(true);
      try {
        await summarizeProfiling(avatarId);
      } catch (error) {
        console.error("Profile summary generation failed:", error);
        setErrorMessage(
          error instanceof Error
            ? `Profiling saved, but profile summary could not be generated: ${error.message}`
            : "Profiling saved, but profile summary could not be generated.",
        );
      } finally {
        setIsSummarizing(false);
      }
    }

    return "finished";
  }

  function goBack(): "previous-question" | "exit" {
    setErrorMessage(null);
    setFieldError(null);

    if (questionIndex > 0) {
      setQuestionIndex((index) => index - 1);
      return "previous-question";
    }

    return "exit";
  }

  return {
    avatar,
    questions,
    questionIndex,
    answers,
    currentQuestion,
    errorMessage,
    fieldError,
    isLoading,
    isSaving,
    isSummarizing,
    setAnswer,
    goNext,
    goBack,
    setErrorMessage,
  };
}

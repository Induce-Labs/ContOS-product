class ContOSBackendError(Exception):
    """Base error for ContOS backend failures."""


class ConfigurationError(ContOSBackendError):
    """Raised when required configuration is missing or invalid."""


class ApifyServiceError(ContOSBackendError):
    """Raised when an Apify actor run fails."""


class LlmServiceError(ContOSBackendError):
    """Raised when LLM summarization fails."""


class RepositoryError(ContOSBackendError):
    """Raised when Supabase persistence fails."""


class PipelineError(ContOSBackendError):
    """Raised when a competitor pipeline step fails."""


class PostizServiceError(ContOSBackendError):
    """Raised when a Postiz API or OAuth operation fails."""


class PostizOAuthStateError(PostizServiceError):
    """Raised when ContOS OAuth state is missing, expired, mismatched, or replayed."""


class PostizAuthorizationInvalidError(PostizServiceError):
    """Raised when a stored Postiz authorization is revoked or no longer valid."""


class PostizIntegrationClaimError(PostizServiceError):
    """Raised when a LinkedIn integration cannot be claimed for this ContOS user."""


class PostizNotConnectedError(PostizServiceError):
    """Raised when the avatar has no claimed LinkedIn integration for publishing."""


class PostizPostNotFoundError(PostizServiceError):
    """Raised when a Postiz post is missing or not owned by this avatar's integration."""

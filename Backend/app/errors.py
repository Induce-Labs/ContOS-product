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
    """Raised when a Postiz API or OAuth operation fails.

    Optional ``status_code`` is the upstream HTTP status when the failure came
    from a Postiz response (never include tokens or secrets in the message).
    """

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


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


class PostizMediaOwnershipError(PostizServiceError):
    """Raised when media ids/paths are not owned by the avatar's Postiz organization."""


class PostizBadRequestError(PostizServiceError):
    """Raised for ContOS-side validation failures on Postiz calendar requests."""

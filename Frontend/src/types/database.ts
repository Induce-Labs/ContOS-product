export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      usage_events: {
        Row: {
          user_email: string | null
          id: string
          created_at: string
          user_id: string | null
          avatar_id: string | null
          operation: string
          provider: string
          model_or_actor: string | null
          input_tokens: number
          output_tokens: number
          embed_tokens: number
          scrape_items: number
          sm_ops: number
          estimated_cost_usd: number
          status: string
          error_message: string | null
          source: string
          source_ref: string | null
          metadata: Json
        }
        Insert: {
          user_email?: string | null
          id?: string
          created_at?: string
          user_id?: string | null
          avatar_id?: string | null
          operation: string
          provider: string
          model_or_actor?: string | null
          input_tokens?: number
          output_tokens?: number
          embed_tokens?: number
          scrape_items?: number
          sm_ops?: number
          estimated_cost_usd?: number
          status?: string
          error_message?: string | null
          source: string
          source_ref?: string | null
          metadata?: Json
        }
        Update: {
          user_email?: string | null
          id?: string
          created_at?: string
          user_id?: string | null
          avatar_id?: string | null
          operation?: string
          provider?: string
          model_or_actor?: string | null
          input_tokens?: number
          output_tokens?: number
          embed_tokens?: number
          scrape_items?: number
          sm_ops?: number
          estimated_cost_usd?: number
          status?: string
          error_message?: string | null
          source?: string
          source_ref?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      usage_price_rates: {
        Row: {
          id: string
          provider: string
          model_or_actor: string | null
          unit: string
          unit_price_usd: number
          effective_from: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          provider: string
          model_or_actor?: string | null
          unit: string
          unit_price_usd: number
          effective_from?: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          provider?: string
          model_or_actor?: string | null
          unit?: string
          unit_price_usd?: number
          effective_from?: string
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      agent_chat_stores: {
        Row: {
          avatar_id: string
          store: Json
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          avatar_id: string
          store: Json
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          avatar_id?: string
          store?: Json
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_chat_stores_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          cancel_requested: boolean
          created_at: string
          error_message: string | null
          handle_or_url: string
          id: string
          last_scraped_at: string | null
          pipeline_step: string
          platform: string
          avatar_id: string
          scrape_status: string
          user_email: string | null
        }
        Insert: {
          cancel_requested?: boolean
          created_at?: string
          error_message?: string | null
          handle_or_url: string
          id?: string
          last_scraped_at?: string | null
          pipeline_step?: string
          platform: string
          avatar_id: string
          scrape_status?: string
          user_email?: string | null
        }
        Update: {
          cancel_requested?: boolean
          created_at?: string
          error_message?: string | null
          handle_or_url?: string
          id?: string
          last_scraped_at?: string | null
          pipeline_step?: string
          platform?: string
          avatar_id?: string
          scrape_status?: string
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_content_summaries: {
        Row: {
          competitor_id: string
          embedding: string | null
          generated_at: string
          id: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email: string | null
        }
        Insert: {
          competitor_id: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email?: string | null
        }
        Update: {
          competitor_id?: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used?: string
          avatar_id?: string
          summary?: Json
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_content_summaries_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_content_summaries_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_content_summaries: {
        Row: {
          competitor_id: string
          embedding: string | null
          generated_at: string
          id: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email: string | null
        }
        Insert: {
          competitor_id: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email?: string | null
        }
        Update: {
          competitor_id?: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used?: string
          avatar_id?: string
          summary?: Json
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_content_summaries_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_content_summaries_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_scraped_content: {
        Row: {
          author_headline: string | null
          author_name: string | null
          caption: string | null
          comments_count: number | null
          competitor_id: string
          external_id: string
          id: string
          likes: number | null
          post_url: string | null
          posted_at: string | null
          raw_payload: Json | null
          scraped_at: string
          shares: number | null
          user_email: string | null
        }
        Insert: {
          author_headline?: string | null
          author_name?: string | null
          caption?: string | null
          comments_count?: number | null
          competitor_id: string
          external_id: string
          id?: string
          likes?: number | null
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          shares?: number | null
          user_email?: string | null
        }
        Update: {
          author_headline?: string | null
          author_name?: string | null
          caption?: string | null
          comments_count?: number | null
          competitor_id?: string
          external_id?: string
          id?: string
          likes?: number | null
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          shares?: number | null
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_scraped_content_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      twitter_content_summaries: {
        Row: {
          competitor_id: string
          embedding: string | null
          generated_at: string
          id: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email: string | null
        }
        Insert: {
          competitor_id: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used: string
          avatar_id: string
          summary: Json
          user_email?: string | null
        }
        Update: {
          competitor_id?: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used?: string
          avatar_id?: string
          summary?: Json
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "twitter_content_summaries_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "twitter_content_summaries_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      twitter_scraped_content: {
        Row: {
          author_description: string | null
          author_followers: number | null
          author_name: string | null
          author_username: string | null
          caption: string | null
          competitor_id: string
          external_id: string
          id: string
          post_url: string | null
          posted_at: string | null
          raw_payload: Json | null
          scraped_at: string
          user_email: string | null
        }
        Insert: {
          author_description?: string | null
          author_followers?: number | null
          author_name?: string | null
          author_username?: string | null
          caption?: string | null
          competitor_id: string
          external_id: string
          id?: string
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          user_email?: string | null
        }
        Update: {
          author_description?: string | null
          author_followers?: number | null
          author_name?: string | null
          author_username?: string | null
          caption?: string | null
          competitor_id?: string
          external_id?: string
          id?: string
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "twitter_scraped_content_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      profiling_questionnaires: {
        Row: {
          created_at: string
          id: string
          label: string
          questions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          label: string
          questions: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          questions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          onboarding_avatar_id: string | null
          onboarding_completed_at: string | null
          onboarding_project_type: string | null
          onboarding_step: string
          preferred_language: string | null
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          onboarding_avatar_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_project_type?: string | null
          onboarding_step?: string
          preferred_language?: string | null
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          onboarding_avatar_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_project_type?: string | null
          onboarding_step?: string
          preferred_language?: string | null
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_onboarding_avatar_id_fkey"
            columns: ["onboarding_avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      avatars: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          profile_summary: string | null
          profile_summary_error: string | null
          profile_summary_generated_at: string | null
          profile_summary_source_hash: string | null
          profile_summary_status: string
          profiling_completeness: number
          profiling_data: Json
          status: string
          type: string
          updated_at: string
          user_id: string
          website_summary: string | null
          website_summary_error: string | null
          website_summary_generated_at: string | null
          website_summary_source_hash: string | null
          website_summary_status: string
          website_summary_url: string | null
          user_email: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          profile_summary?: string | null
          profile_summary_error?: string | null
          profile_summary_generated_at?: string | null
          profile_summary_source_hash?: string | null
          profile_summary_status?: string
          profiling_completeness?: number
          profiling_data?: Json
          status?: string
          type: string
          updated_at?: string
          user_id: string
          user_email?: string | null
          website_summary?: string | null
          website_summary_error?: string | null
          website_summary_generated_at?: string | null
          website_summary_source_hash?: string | null
          website_summary_status?: string
          website_summary_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          profile_summary?: string | null
          profile_summary_error?: string | null
          profile_summary_generated_at?: string | null
          profile_summary_source_hash?: string | null
          profile_summary_status?: string
          profiling_completeness?: number
          profiling_data?: Json
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
          user_email?: string | null
          website_summary?: string | null
          website_summary_error?: string | null
          website_summary_generated_at?: string | null
          website_summary_source_hash?: string | null
          website_summary_status?: string
          website_summary_url?: string | null
        }
        Relationships: []
      }
      instagram_scraped_content: {
        Row: {
          caption: string | null
          comments_count: number | null
          competitor_id: string
          content_type: string
          external_id: string
          id: string
          likes: number | null
          platform: string
          post_url: string | null
          posted_at: string | null
          raw_payload: Json | null
          scraped_at: string
          shares: number | null
          transcript: string | null
          transcript_source: string | null
          transcription_status: string
          views: number | null
          user_email: string | null
        }
        Insert: {
          caption?: string | null
          comments_count?: number | null
          competitor_id: string
          content_type?: string
          external_id: string
          id?: string
          likes?: number | null
          platform: string
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          shares?: number | null
          transcript?: string | null
          transcript_source?: string | null
          transcription_status?: string
          views?: number | null
          user_email?: string | null
        }
        Update: {
          caption?: string | null
          comments_count?: number | null
          competitor_id?: string
          content_type?: string
          external_id?: string
          id?: string
          likes?: number | null
          platform?: string
          post_url?: string | null
          posted_at?: string | null
          raw_payload?: Json | null
          scraped_at?: string
          shares?: number | null
          transcript?: string | null
          transcript_source?: string | null
          transcription_status?: string
          views?: number | null
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_scraped_content_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      usage_daily_by_user: {
        Row: {
          day_utc: string | null
          user_email: string | null
          user_id: string | null
          operation: string | null
          provider: string | null
          event_count: number | null
          input_tokens: number | null
          output_tokens: number | null
          embed_tokens: number | null
          scrape_items: number | null
          sm_ops: number | null
          estimated_cost_usd: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      contos_log_usage_event: {
        Args: {
          p_user_id?: string | null
          p_avatar_id?: string | null
          p_operation: string
          p_provider: string
          p_model_or_actor?: string | null
          p_input_tokens?: number
          p_output_tokens?: number
          p_embed_tokens?: number
          p_scrape_items?: number
          p_sm_ops?: number
          p_status?: string
          p_error_message?: string | null
          p_source?: string
          p_source_ref?: string | null
          p_metadata?: Json
        }
        Returns: string
      }
      contos_usage_unit_price: {
        Args: {
          p_provider: string
          p_model_or_actor: string | null
          p_unit: string
        }
        Returns: number
      }
      resolve_profiling_template: {
        Args: { p_avatar_type: string }
        Returns: string
      }
      set_default_avatar: {
        Args: { p_avatar_id: string }
        Returns: Database["public"]["Tables"]["avatars"]["Row"]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

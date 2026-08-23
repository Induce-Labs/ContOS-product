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
        }
        Insert: {
          competitor_id: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used: string
          avatar_id: string
          summary: Json
        }
        Update: {
          competitor_id?: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used?: string
          avatar_id?: string
          summary?: Json
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
        }
        Insert: {
          competitor_id: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used: string
          avatar_id: string
          summary: Json
        }
        Update: {
          competitor_id?: string
          embedding?: string | null
          generated_at?: string
          id?: string
          model_used?: string
          avatar_id?: string
          summary?: Json
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
      profiling_questions: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          question: string
          question_key: string
          type: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          question: string
          question_key: string
          type: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          question?: string
          question_key?: string
          type?: string
        }
        Relationships: []
      }
      avatars: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          profiling_completeness: number
          profiling_data: Json
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          profiling_completeness?: number
          profiling_data?: Json
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          profiling_completeness?: number
          profiling_data?: Json
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
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
      [_ in never]: never
    }
    Functions: {
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

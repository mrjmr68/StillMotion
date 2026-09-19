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
      cardio_logs: {
        Row: {
          created_at: string
          distance_meters: number | null
          duration_seconds: number | null
          id: string
          note: string | null
          performed_at: string
          session_id: string | null
          steps: number | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          distance_meters?: number | null
          duration_seconds?: number | null
          id?: string
          note?: string | null
          performed_at?: string
          session_id?: string | null
          steps?: number | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          distance_meters?: number | null
          duration_seconds?: number | null
          id?: string
          note?: string | null
          performed_at?: string
          session_id?: string | null
          steps?: number | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cardio_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_catalog: {
        Row: {
          aka: string[]
          asset_kind: string | null
          asset_path: string
          asset_ready: boolean
          asset_tier: string
          avoid_after: string[]
          body_position: string
          created_at: string
          cues: string[]
          default_dose: number
          equipment: string[]
          id: string
          intensity: number
          is_anchor: boolean
          loop_seconds: number | null
          modality: string
          movement_pattern: string
          name: string
          pairs_well_with: string[]
          primary_regions: string[]
          progression_id: string | null
          regression_id: string | null
          rep_cap_seconds: number | null
          secondary_regions: string[]
          setup_note: string | null
          timing_type: string
          unilateral: boolean
          updated_at: string
        }
        Insert: {
          aka?: string[]
          asset_kind?: string | null
          asset_path: string
          asset_ready?: boolean
          asset_tier: string
          avoid_after?: string[]
          body_position: string
          created_at?: string
          cues?: string[]
          default_dose: number
          equipment?: string[]
          id: string
          intensity: number
          is_anchor?: boolean
          loop_seconds?: number | null
          modality: string
          movement_pattern: string
          name: string
          pairs_well_with?: string[]
          primary_regions?: string[]
          progression_id?: string | null
          regression_id?: string | null
          rep_cap_seconds?: number | null
          secondary_regions?: string[]
          setup_note?: string | null
          timing_type: string
          unilateral?: boolean
          updated_at?: string
        }
        Update: {
          aka?: string[]
          asset_kind?: string | null
          asset_path?: string
          asset_ready?: boolean
          asset_tier?: string
          avoid_after?: string[]
          body_position?: string
          created_at?: string
          cues?: string[]
          default_dose?: number
          equipment?: string[]
          id?: string
          intensity?: number
          is_anchor?: boolean
          loop_seconds?: number | null
          modality?: string
          movement_pattern?: string
          name?: string
          pairs_well_with?: string[]
          primary_regions?: string[]
          progression_id?: string | null
          regression_id?: string | null
          rep_cap_seconds?: number | null
          secondary_regions?: string[]
          setup_note?: string | null
          timing_type?: string
          unilateral?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_catalog_progression_id_fkey"
            columns: ["progression_id"]
            isOneToOne: false
            referencedRelation: "exercise_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_catalog_regression_id_fkey"
            columns: ["regression_id"]
            isOneToOne: false
            referencedRelation: "exercise_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_logs: {
        Row: {
          block_index: number
          completed_dose: number | null
          created_at: string
          exercise_id: string
          id: string
          item_index: number
          load: Json | null
          prescribed_dose: number
          rest_seconds: number | null
          session_id: string
          side: string | null
          swapped_to_exercise_id: string | null
          user_id: string
          was_skipped: boolean
          was_swapped: boolean
        }
        Insert: {
          block_index: number
          completed_dose?: number | null
          created_at?: string
          exercise_id: string
          id?: string
          item_index: number
          load?: Json | null
          prescribed_dose: number
          rest_seconds?: number | null
          session_id: string
          side?: string | null
          swapped_to_exercise_id?: string | null
          user_id: string
          was_skipped?: boolean
          was_swapped?: boolean
        }
        Update: {
          block_index?: number
          completed_dose?: number | null
          created_at?: string
          exercise_id?: string
          id?: string
          item_index?: number
          load?: Json | null
          prescribed_dose?: number
          rest_seconds?: number | null
          session_id?: string
          side?: string | null
          swapped_to_exercise_id?: string | null
          user_id?: string
          was_skipped?: boolean
          was_swapped?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exercise_logs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercise_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_swapped_to_exercise_id_fkey"
            columns: ["swapped_to_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercise_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      pairings: {
        Row: {
          claimed_at: string | null
          code: string
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string | null
          revoked_at: string | null
          stage_screen: string
          stage_token_hash: string | null
          user_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string | null
          revoked_at?: string | null
          stage_screen?: string
          stage_token_hash?: string | null
          user_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string | null
          revoked_at?: string | null
          stage_screen?: string
          stage_token_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      session_live_state: {
        Row: {
          created_at: string
          cue_level: string
          current_block_index: number
          current_item_index: number
          is_paused: boolean
          pending_command: string | null
          pending_command_payload: Json | null
          phase: string | null
          phase_index: number
          seconds_remaining: number
          session_id: string
          side: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cue_level?: string
          current_block_index?: number
          current_item_index?: number
          is_paused?: boolean
          pending_command?: string | null
          pending_command_payload?: Json | null
          phase?: string | null
          phase_index?: number
          seconds_remaining?: number
          session_id: string
          side?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cue_level?: string
          current_block_index?: number
          current_item_index?: number
          is_paused?: boolean
          pending_command?: string | null
          pending_command_payload?: Json | null
          phase?: string | null
          phase_index?: number
          seconds_remaining?: number
          session_id?: string
          side?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_live_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          checkin_input: Json
          completed_at: string | null
          created_at: string
          id: string
          note: string | null
          plan_generated: Json
          plan_performed: Json | null
          rating: string | null
          requested_duration_min: number
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checkin_input: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          plan_generated: Json
          plan_performed?: Json | null
          rating?: string | null
          requested_duration_min: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checkin_input?: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          plan_generated?: Json
          plan_performed?: Json | null
          rating?: string | null
          requested_duration_min?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_movement_preferences: {
        Row: {
          created_at: string
          exercise_id: string
          preference: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          preference: string
          user_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          preference?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_movement_preferences_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercise_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          cue_level: string
          emphasis: string
          equipment_on_hand: string[]
          floor_tolerance: string
          format_preference: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cue_level?: string
          emphasis?: string
          equipment_on_hand?: string[]
          floor_tolerance?: string
          format_preference?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cue_level?: string
          emphasis?: string
          equipment_on_hand?: string[]
          floor_tolerance?: string
          format_preference?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

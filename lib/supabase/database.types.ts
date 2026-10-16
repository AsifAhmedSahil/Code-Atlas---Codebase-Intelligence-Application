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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          adapter: string | null
          commit_sha: string | null
          counts: Json | null
          coverage: Json | null
          created_at: string
          error: string | null
          error_stage: string | null
          finished_at: string | null
          id: string
          organization_id: string
          project_id: string
          root: string | null
          stage: string | null
          stage_message: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adapter?: string | null
          commit_sha?: string | null
          counts?: Json | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          error_stage?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          project_id: string
          root?: string | null
          stage?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adapter?: string | null
          commit_sha?: string | null
          counts?: Json | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          error_stage?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          root?: string | null
          stage?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          created_at: string
          id: string
          kind: string
          organization_id: string
          source_file_id: string
          target_file_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          source_file_id: string
          target_file_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          source_file_id?: string
          target_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_target_file_id_fkey"
            columns: ["target_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          id: string
          organization_id: string
          subject_id: string
          subject_kind: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          id?: string
          organization_id: string
          subject_id: string
          subject_kind: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          subject_id?: string
          subject_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          created_at: string
          file_id: string
          id: string
          organization_id: string
          role: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_id: string
          id?: string
          organization_id: string
          role: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_roles_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          bytes: number | null
          created_at: string
          extension: string | null
          fan_in: number
          fan_out: number
          folder: string
          hash: string | null
          id: string
          is_module: boolean
          lines: number | null
          organization_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          bytes?: number | null
          created_at?: string
          extension?: string | null
          fan_in?: number
          fan_out?: number
          folder?: string
          hash?: string | null
          id?: string
          is_module?: boolean
          lines?: number | null
          organization_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          bytes?: number | null
          created_at?: string
          extension?: string | null
          fan_in?: number
          fan_out?: number
          folder?: string
          hash?: string | null
          id?: string
          is_module?: boolean
          lines?: number | null
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          created_at: string
          detail: string | null
          file_id: string | null
          id: string
          kind: string
          organization_id: string
          title: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          detail?: string | null
          file_id?: string | null
          id?: string
          kind: string
          organization_id: string
          title: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          detail?: string | null
          file_id?: string | null
          id?: string
          kind?: string
          organization_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insights_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string | null
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          slug?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          default_branch: string | null
          id: string
          name: string
          organization_id: string
          repo_url: string
        }
        Insert: {
          created_at?: string
          default_branch?: string | null
          id?: string
          name: string
          organization_id: string
          repo_url: string
        }
        Update: {
          created_at?: string
          default_branch?: string | null
          id?: string
          name?: string
          organization_id?: string
          repo_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          created_at: string
          file_id: string | null
          framework: string
          id: string
          kind: string
          method: string | null
          organization_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_id?: string | null
          framework: string
          id?: string
          kind: string
          method?: string | null
          organization_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_id?: string | null
          framework?: string
          id?: string
          kind?: string
          method?: string | null
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skipped_files: {
        Row: {
          analysis_id: string
          created_at: string
          detail: string | null
          id: string
          organization_id: string
          path: string
          reason: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          detail?: string | null
          id?: string
          organization_id: string
          path: string
          reason: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          organization_id?: string
          path?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "skipped_files_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skipped_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
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
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
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
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] &
        DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["Views"])
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] &
      DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["Views"])[CompositeTypeName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicCompositeTypeNameOrOptions extends keyof (DefaultSchema["CompositeTypes"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["CompositeTypes"] &
        DefaultSchema["Views"])[PublicCompositeTypeNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

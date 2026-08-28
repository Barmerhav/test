export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_plan_change: {
        Args: never
        Returns: Database["public"]["Tables"]["subscriptions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_assign_request: {
        Args: { p_picker_id: string; p_request_id: string }
        Returns: Json
      }
      admin_force_transition: {
        Args: { p_note?: string; p_request_id: string; p_to: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_grant_credit: {
        Args: { p_note?: string; p_units: number; p_user_id: string }
        Returns: string
      }
      admin_list_buildings: {
        Args: never
        Returns: {
          bin_location_note: string
          bin_qr_id: string
          city: string
          house_number: string
          id: string
          paused: boolean
          street: string
        }[]
      }
      admin_metrics: { Args: never; Returns: Json }
      admin_requests_board: { Args: never; Returns: Json }
      admin_retire_plan: { Args: { p_code: string }; Returns: undefined }
      admin_run_payout: { Args: never; Returns: string }
      admin_set_building_paused: {
        Args: { p_building_id: string; p_paused: boolean }
        Returns: undefined
      }
      admin_set_config: {
        Args: { p_key: string; p_note?: string; p_value: Json }
        Returns: Json
      }
      admin_set_string: {
        Args: { p_key: string; p_locale: string; p_value: string }
        Returns: undefined
      }
      admin_upsert_plan: {
        Args: {
          p_bags_included?: boolean
          p_code: string
          p_note?: string
          p_price_shekels: number
          p_units: number
        }
        Returns: Json
      }
      admin_verify_picker: {
        Args: { p_approve: boolean; p_user_id: string }
        Returns: undefined
      }
      apply_referral_code: { Args: { p_code: string }; Returns: undefined }
      approve_pickup: {
        Args: { p_request_id: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attach_payment_method: {
        Args: {
          p_brand?: string
          p_last4?: string
          p_provider: string
          p_token: string
        }
        Returns: string
      }
      cancel_request: {
        Args: { p_request_id: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_plan: {
        Args: { p_plan_id: string }
        Returns: Database["public"]["Tables"]["subscriptions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_request: { Args: { p_request_id: string }; Returns: Json }
      confirm_bag_out: {
        Args: { p_request_id: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_eta: {
        Args: { p_request_id: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_leak: {
        Args: { p_claim_id: string; p_photo_path: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_state: { Args: never; Returns: Json }
      mark_collected: {
        Args: { p_adjustment?: Json; p_claim_id: string }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      onboard_residency: {
        Args: {
          p_apartment: string
          p_city: string
          p_door_note?: string
          p_entry_code?: string
          p_floor: number
          p_house_number: string
          p_lat?: number
          p_lng?: number
          p_street: string
        }
        Returns: string
      }
      open_feed: {
        Args: { p_lat?: number; p_lng?: number }
        Returns: {
          building_id: string
          building_open_count: number
          city: string
          created_at: string
          distance_m: number
          expires_at: string
          house_number: string
          lat: number
          lng: number
          payout_agorot: number
          request_id: string
          street: string
          units: number
        }[]
      }
      pause_subscription: { Args: never; Returns: undefined }
      register_device: {
        Args: { p_expo_push_token: string; p_platform?: string }
        Returns: undefined
      }
      register_leak_photo: {
        Args: { p_request_id: string; p_storage_path: string }
        Returns: string
      }
      register_picker: {
        Args: {
          p_bank_details?: Json
          p_birthdate: string
          p_id_number: string
          p_poa_consent: boolean
          p_tax_status: string
          p_vat_id?: string
        }
        Returns: Database["public"]["Tables"]["pickers"]["Row"]
        SetofOptions: {
          from: "*"
          to: "pickers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_claim: { Args: { p_claim_id: string }; Returns: undefined }
      resume_subscription: { Args: never; Returns: undefined }
      reveal_entry_code: { Args: { p_claim_id: string }; Returns: Json }
      service_charge_backstop: { Args: { p_request_id: string }; Returns: Json }
      service_charge_boost: { Args: { p_request_id: string }; Returns: Json }
      service_charge_extra_roll: {
        Args: { p_format: string; p_user_id: string }
        Returns: Json
      }
      service_charge_on_demand: {
        Args: { p_ttl_option: string; p_user_id: string }
        Returns: Json
      }
      service_charge_subscription: {
        Args: { p_subscription_id: string }
        Returns: Json
      }
      service_log_sms: {
        Args: { p_body: string; p_phone: string }
        Returns: undefined
      }
      service_mark_batch_exported: {
        Args: {
          p_batch_id: string
          p_csv_path: string
          p_invoice_paths: Json
          p_masav_path: string
        }
        Returns: undefined
      }
      service_mark_charge_provider: {
        Args: { p_charge_id: string; p_provider_charge_id: string }
        Returns: undefined
      }
      service_payout_batch: { Args: { p_batch_id: string }; Returns: Json }
      service_rate_limit_ok: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      service_retry_failed_renewals: { Args: never; Returns: number }
      service_run_payout: { Args: never; Returns: string }
      service_settle_charge: {
        Args: {
          p_failure_reason?: string
          p_outcome: string
          p_provider_charge_id: string
        }
        Returns: Json
      }
      service_tick_daily: { Args: never; Returns: Json }
      service_tick_minutely: { Args: never; Returns: Json }
      set_building_entry_code: {
        Args: { p_building_id: string; p_entry_code: string }
        Returns: undefined
      }
      set_picker_availability: {
        Args: { p_available: boolean }
        Returns: undefined
      }
      start_subscription: {
        Args: {
          p_bag_format?: string
          p_plan_id: string
          p_residency_id: string
        }
        Returns: Database["public"]["Tables"]["subscriptions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_request: {
        Args: { p_notes?: string; p_ttl_option?: string; p_units: number }
        Returns: Database["public"]["Tables"]["requests"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_profile: {
        Args: {
          p_confirm_first?: boolean
          p_default_mode?: string
          p_full_name?: string
          p_locale?: string
        }
        Returns: Database["public"]["Tables"]["users"]["Row"]
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_bin_scan: {
        Args: { p_claim_id: string; p_qr_payload: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          created_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bag_rolls: {
        Row: {
          charge_id: string | null
          delivered_at: string | null
          format: string
          id: string
          ordered_at: string
          roll_count: number
          source: string
          status: string
          user_id: string
        }
        Insert: {
          charge_id?: string | null
          delivered_at?: string | null
          format: string
          id?: string
          ordered_at?: string
          roll_count: number
          source: string
          status?: string
          user_id: string
        }
        Update: {
          charge_id?: string | null
          delivered_at?: string | null
          format?: string
          id?: string
          ordered_at?: string
          roll_count?: number
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bag_rolls_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bag_rolls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      building_meter_awards: {
        Row: {
          awarded_at: string
          building_id: string
          id: string
          tier_doors: number
        }
        Insert: {
          awarded_at?: string
          building_id: string
          id?: string
          tier_doors: number
        }
        Update: {
          awarded_at?: string
          building_id?: string
          id?: string
          tier_doors?: number
        }
        Relationships: [
          {
            foreignKeyName: "building_meter_awards_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "building_meter"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_meter_awards_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          bin_location_note: string | null
          bin_qr_id: string
          city: string
          created_at: string
          entry_code_enc: string | null
          house_number: string
          id: string
          lat: number | null
          lng: number | null
          paused: boolean
          street: string
          updated_at: string
        }
        Insert: {
          bin_location_note?: string | null
          bin_qr_id?: string
          city: string
          created_at?: string
          entry_code_enc?: string | null
          house_number: string
          id?: string
          lat?: number | null
          lng?: number | null
          paused?: boolean
          street: string
          updated_at?: string
        }
        Update: {
          bin_location_note?: string | null
          bin_qr_id?: string
          city?: string
          created_at?: string
          entry_code_enc?: string | null
          house_number?: string
          id?: string
          lat?: number | null
          lng?: number | null
          paused?: boolean
          street?: string
          updated_at?: string
        }
        Relationships: []
      }
      charges: {
        Row: {
          amount_agorot: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          kind: string
          meta: Json
          provider: string
          provider_charge_id: string | null
          settled_at: string | null
          status: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount_agorot: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          kind: string
          meta?: Json
          provider: string
          provider_charge_id?: string | null
          settled_at?: string | null
          status?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount_agorot?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          meta?: Json
          provider?: string
          provider_charge_id?: string | null
          settled_at?: string | null
          status?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "charges_subscription_fk"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          adjustment: Json | null
          claim_group_id: string
          claimed_at: string
          collected_at: string | null
          created_at: string
          deadline_at: string
          id: string
          leak_photo_path: string | null
          payout_boost_agorot: number
          payout_per_unit_agorot: number
          picker_id: string
          request_id: string
          status: string
          units_collected: number | null
          verified_at: string | null
        }
        Insert: {
          adjustment?: Json | null
          claim_group_id: string
          claimed_at?: string
          collected_at?: string | null
          created_at?: string
          deadline_at: string
          id?: string
          leak_photo_path?: string | null
          payout_boost_agorot?: number
          payout_per_unit_agorot: number
          picker_id: string
          request_id: string
          status?: string
          units_collected?: number | null
          verified_at?: string | null
        }
        Update: {
          adjustment?: Json | null
          claim_group_id?: string
          claimed_at?: string
          collected_at?: string | null
          created_at?: string
          deadline_at?: string
          id?: string
          leak_photo_path?: string | null
          payout_boost_agorot?: number
          payout_per_unit_agorot?: number
          picker_id?: string
          request_id?: string
          status?: string
          units_collected?: number | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_picker_id_fkey"
            columns: ["picker_id"]
            isOneToOne: false
            referencedRelation: "pickers"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "claims_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      code_reveal_audit: {
        Row: {
          building_id: string
          claim_id: string
          id: number
          picker_id: string
          reveal_expires_at: string
          revealed_at: string
        }
        Insert: {
          building_id: string
          claim_id: string
          id?: number
          picker_id: string
          reveal_expires_at: string
          revealed_at?: string
        }
        Update: {
          building_id?: string
          claim_id?: string
          id?: number
          picker_id?: string
          reveal_expires_at?: string
          revealed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_reveal_audit_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      config: {
        Row: {
          description: string
          key: string
          schema: Json
          updated_at: string
          updated_by: string | null
          value: Json
          version: number
        }
        Insert: {
          description?: string
          key: string
          schema: Json
          updated_at?: string
          updated_by?: string | null
          value: Json
          version?: number
        }
        Update: {
          description?: string
          key?: string
          schema?: Json
          updated_at?: string
          updated_by?: string | null
          value?: Json
          version?: number
        }
        Relationships: []
      }
      config_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          key: string
          new_value: Json
          new_version: number
          note: string | null
          old_value: Json | null
          old_version: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          key: string
          new_value: Json
          new_version: number
          note?: string | null
          old_value?: Json | null
          old_version?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          key?: string
          new_value?: Json
          new_version?: number
          note?: string | null
          old_value?: Json | null
          old_version?: number | null
        }
        Relationships: []
      }
      credit_consumptions: {
        Row: {
          consumed_at: string
          credit_id: string
          id: number
          request_id: string
          units: number
        }
        Insert: {
          consumed_at?: string
          credit_id: string
          id?: number
          request_id: string
          units: number
        }
        Update: {
          consumed_at?: string
          credit_id?: string
          id?: number
          request_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_consumptions_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_consumptions_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          expires_at: string | null
          granted_at: string
          id: string
          reason: string
          source_id: string | null
          status: string
          units_consumed: number
          units_granted: number
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          id?: string
          reason: string
          source_id?: string | null
          status?: string
          units_consumed?: number
          units_granted: number
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          id?: string
          reason?: string
          source_id?: string | null
          status?: string
          units_consumed?: number
          units_granted?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          expo_push_token: string
          id: string
          last_seen_at: string
          platform: string | null
          user_id: string
        }
        Insert: {
          expo_push_token: string
          id?: string
          last_seen_at?: string
          platform?: string | null
          user_id: string
        }
        Update: {
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          platform?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices_selfbilled: {
        Row: {
          amount_exvat_agorot: number
          id: string
          invoice_number: string
          issued_at: string
          payout_id: string
          pdf_path: string | null
          picker_id: string
          tax_status_snapshot: string
          total_agorot: number
          vat_agorot: number
        }
        Insert: {
          amount_exvat_agorot: number
          id?: string
          invoice_number: string
          issued_at?: string
          payout_id: string
          pdf_path?: string | null
          picker_id: string
          tax_status_snapshot: string
          total_agorot: number
          vat_agorot: number
        }
        Update: {
          amount_exvat_agorot?: number
          id?: string
          invoice_number?: string
          issued_at?: string
          payout_id?: string
          pdf_path?: string | null
          picker_id?: string
          tax_status_snapshot?: string
          total_agorot?: number
          vat_agorot?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_selfbilled_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: true
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_sms_log: {
        Row: {
          body: string
          id: number
          phone: string
          sent_at: string
        }
        Insert: {
          body: string
          id?: number
          phone: string
          sent_at?: string
        }
        Update: {
          body?: string
          id?: number
          phone?: string
          sent_at?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          channel: string
          claimed_at: string | null
          created_at: string
          id: number
          last_error: string | null
          params: Json
          sent_at: string | null
          status: string
          template_key: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          params?: Json
          sent_at?: string | null
          status?: string
          template_key: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          params?: Json
          sent_at?: string | null
          status?: string
          template_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          last4: string | null
          provider: string
          provider_token: string
          status: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          last4?: string | null
          provider: string
          provider_token: string
          status?: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          last4?: string | null
          provider?: string
          provider_token?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          created_by: string | null
          csv_path: string | null
          id: string
          masav_path: string | null
          period_end: string
          period_start: string | null
          run_at: string
          status: string
        }
        Insert: {
          created_by?: string | null
          csv_path?: string | null
          id?: string
          masav_path?: string | null
          period_end: string
          period_start?: string | null
          run_at?: string
          status?: string
        }
        Update: {
          created_by?: string | null
          csv_path?: string | null
          id?: string
          masav_path?: string | null
          period_end?: string
          period_start?: string | null
          run_at?: string
          status?: string
        }
        Relationships: []
      }
      payout_lines: {
        Row: {
          amount_agorot: number
          boost_agorot: number
          claim_id: string
          created_at: string
          id: number
          payout_id: string | null
          per_unit_agorot: number
          picker_id: string
          request_id: string
          units: number
        }
        Insert: {
          amount_agorot: number
          boost_agorot?: number
          claim_id: string
          created_at?: string
          id?: number
          payout_id?: string | null
          per_unit_agorot: number
          picker_id: string
          request_id: string
          units: number
        }
        Update: {
          amount_agorot?: number
          boost_agorot?: number
          claim_id?: string
          created_at?: string
          id?: number
          payout_id?: string | null
          per_unit_agorot?: number
          picker_id?: string
          request_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "payout_lines_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_lines_payout_fk"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_lines_picker_id_fkey"
            columns: ["picker_id"]
            isOneToOne: false
            referencedRelation: "pickers"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payout_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_exvat_agorot: number
          batch_id: string
          created_at: string
          id: string
          paid_at: string | null
          period_end: string
          period_start: string | null
          picker_id: string
          status: string
          total_agorot: number
          total_units: number
          vat_agorot: number
          vat_rate: number
        }
        Insert: {
          amount_exvat_agorot: number
          batch_id: string
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end: string
          period_start?: string | null
          picker_id: string
          status?: string
          total_agorot: number
          total_units: number
          vat_agorot: number
          vat_rate: number
        }
        Update: {
          amount_exvat_agorot?: number
          batch_id?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string | null
          picker_id?: string
          status?: string
          total_agorot?: number
          total_units?: number
          vat_agorot?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "payouts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_picker_id_fkey"
            columns: ["picker_id"]
            isOneToOne: false
            referencedRelation: "pickers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          delete_after: string
          id: string
          kind: string
          owner_id: string
          request_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          delete_after: string
          id?: string
          kind?: string
          owner_id: string
          request_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          delete_after?: string
          id?: string
          kind?: string
          owner_id?: string
          request_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      picker_strikes: {
        Row: {
          claim_id: string | null
          created_at: string
          id: number
          picker_id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          claim_id?: string | null
          created_at?: string
          id?: number
          picker_id: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          claim_id?: string | null
          created_at?: string
          id?: number
          picker_id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picker_strikes_claim_fk"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picker_strikes_picker_id_fkey"
            columns: ["picker_id"]
            isOneToOne: false
            referencedRelation: "pickers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pickers: {
        Row: {
          available: boolean
          bank_details: Json | null
          birthdate: string
          created_at: string
          id_number_hash: string
          poa_consent_at: string
          poa_version: string
          status: string
          strikes: number
          tax_status: string
          user_id: string
          vat_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          available?: boolean
          bank_details?: Json | null
          birthdate: string
          created_at?: string
          id_number_hash: string
          poa_consent_at: string
          poa_version: string
          status?: string
          strikes?: number
          tax_status: string
          user_id: string
          vat_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          available?: boolean
          bank_details?: Json | null
          birthdate?: string
          created_at?: string
          id_number_hash?: string
          poa_consent_at?: string
          poa_version?: string
          status?: string
          strikes?: number
          tax_status?: string
          user_id?: string
          vat_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active_for_signup: boolean
          bags_included: boolean
          code: string
          created_at: string
          created_by: string | null
          id: string
          name_strings_key: string
          price_agorot: number
          units_per_month: number
          version: number
        }
        Insert: {
          active_for_signup?: boolean
          bags_included?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name_strings_key: string
          price_agorot: number
          units_per_month: number
          version: number
        }
        Update: {
          active_for_signup?: boolean
          bags_included?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name_strings_key?: string
          price_agorot?: number
          units_per_month?: number
          version?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          referee_id: string
          referrer_id: string
          rewarded_at: string | null
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          referee_id: string
          referrer_id: string
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          rewarded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_agorot: number
          charge_id: string
          created_at: string
          id: string
          idempotency_key: string
          provider_refund_id: string | null
          reason: string
          settled_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_agorot: number
          charge_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          provider_refund_id?: string | null
          reason: string
          settled_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_agorot?: number
          charge_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          provider_refund_id?: string | null
          reason?: string
          settled_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      request_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          created_at: string
          from_status: string | null
          id: number
          meta: Json
          request_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_role: string
          created_at?: string
          from_status?: string | null
          id?: number
          meta?: Json
          request_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          from_status?: string | null
          id?: number
          meta?: Json
          request_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          boost_agorot: number
          building_id: string
          charge_id: string | null
          confirm_first: boolean
          created_at: string
          expires_at: string
          id: string
          notes: string | null
          repost_count: number
          residency_id: string
          resident_id: string
          status: string
          subscription_id: string | null
          ttl_option: string
          units_final: number | null
          units_requested: number
          units_source: Json
          updated_at: string
        }
        Insert: {
          boost_agorot?: number
          building_id: string
          charge_id?: string | null
          confirm_first?: boolean
          created_at?: string
          expires_at: string
          id?: string
          notes?: string | null
          repost_count?: number
          residency_id: string
          resident_id: string
          status?: string
          subscription_id?: string | null
          ttl_option: string
          units_final?: number | null
          units_requested: number
          units_source?: Json
          updated_at?: string
        }
        Update: {
          boost_agorot?: number
          building_id?: string
          charge_id?: string | null
          confirm_first?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          notes?: string | null
          repost_count?: number
          residency_id?: string
          resident_id?: string
          status?: string
          subscription_id?: string | null
          ttl_option?: string
          units_final?: number | null
          units_requested?: number
          units_source?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "building_meter"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "requests_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_residency_id_fkey"
            columns: ["residency_id"]
            isOneToOne: false
            referencedRelation: "residencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      residencies: {
        Row: {
          apartment: string
          building_id: string
          created_at: string
          door_note: string | null
          floor: number | null
          id: string
          is_primary: boolean
          user_id: string
        }
        Insert: {
          apartment: string
          building_id: string
          created_at?: string
          door_note?: string | null
          floor?: number | null
          id?: string
          is_primary?: boolean
          user_id: string
        }
        Update: {
          apartment?: string
          building_id?: string
          created_at?: string
          door_note?: string | null
          floor?: number | null
          id?: string
          is_primary?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "residencies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "building_meter"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "residencies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "residencies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      strings: {
        Row: {
          key: string
          locale: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          locale: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          locale?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          created_at: string
          event: string
          id: number
          meta: Json
          subscription_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          event: string
          id?: number
          meta?: Json
          subscription_id: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          event?: string
          id?: number
          meta?: Json
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          bag_format: string
          billing_anchor_day: number | null
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          next_reset_at: string | null
          paused_at: string | null
          payment_method_id: string | null
          pending_plan_id: string | null
          plan_accepted_at: string
          plan_id: string
          residency_id: string
          status: string
          units_included: number
          units_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bag_format?: string
          billing_anchor_day?: number | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          next_reset_at?: string | null
          paused_at?: string | null
          payment_method_id?: string | null
          pending_plan_id?: string | null
          plan_accepted_at?: string
          plan_id: string
          residency_id: string
          status?: string
          units_included?: number
          units_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bag_format?: string
          billing_anchor_day?: number | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          next_reset_at?: string | null
          paused_at?: string | null
          payment_method_id?: string | null
          pending_plan_id?: string | null
          plan_accepted_at?: string
          plan_id?: string
          residency_id?: string
          status?: string
          units_included?: number
          units_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_pending_plan_id_fkey"
            columns: ["pending_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_residency_id_fkey"
            columns: ["residency_id"]
            isOneToOne: false
            referencedRelation: "residencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          confirm_first: boolean
          created_at: string
          default_mode: string
          full_name: string | null
          id: string
          locale: string
          phone: string
          referral_code: string
          updated_at: string
        }
        Insert: {
          confirm_first?: boolean
          created_at?: string
          default_mode?: string
          full_name?: string | null
          id: string
          locale?: string
          phone: string
          referral_code: string
          updated_at?: string
        }
        Update: {
          confirm_first?: boolean
          created_at?: string
          default_mode?: string
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string
          referral_code?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      building_meter: {
        Row: {
          active_doors: number | null
          building_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      json_matches_schema: {
        Args: { instance: Json; schema: Json }
        Returns: boolean
      }
      jsonb_matches_schema: {
        Args: { instance: Json; schema: Json }
        Returns: boolean
      }
      jsonschema_is_valid: { Args: { schema: Json }; Returns: boolean }
      jsonschema_validation_errors: {
        Args: { instance: Json; schema: Json }
        Returns: string[]
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

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ref_code text NOT NULL UNIQUE,
  user_id uuid,
  reporter_name text NOT NULL,
  reporter_mobile text,
  category text NOT NULL,
  other_text text,
  area text NOT NULL,
  description text NOT NULL,
  loc_name text NOT NULL,
  full_address text,
  lat double precision,
  lon double precision,
  photo_url text,
  video_url text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_created_at_idx ON public.reports (created_at DESC);
CREATE INDEX reports_status_idx ON public.reports (status);

GRANT SELECT ON public.reports TO anon;
GRANT SELECT, INSERT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view reports" ON public.reports FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Signed-in users can file reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Signed-in users can update report status" ON public.reports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- Record whether the price was public (product published) when it was set.
-- The caller passes it in the transaction-local setting app.price_public ('true' / 'false').
CREATE OR REPLACE FUNCTION record_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source text := coalesce(nullif(current_setting('app.price_source', true), ''), 'SELLER');
  actor text := nullif(current_setting('app.actor_id', true), '');
  is_public boolean := coalesce(nullif(current_setting('app.price_public', true), '')::boolean, false);
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.original_price = OLD.original_price
     AND NEW.sale_price = OLD.sale_price THEN
    RETURN NEW;
  END IF;
  INSERT INTO price_history (variant_id, original_price, sale_price, source, changed_by, is_public)
  VALUES (NEW.id, NEW.original_price, NEW.sale_price, source::price_change_source, actor::uuid, is_public);
  RETURN NEW;
END;
$$;

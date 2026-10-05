-- Keep updated_at current on every UPDATE, even if application code forgets it.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER store_locations_set_updated_at BEFORE UPDATE ON store_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER inventory_set_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER platform_settings_set_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The inventory ledger is append-only: history of stock movements can never be rewritten.
CREATE FUNCTION reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_transactions_append_only
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER price_history_append_only
  BEFORE UPDATE OR DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint

-- Record every price of a variant. The caller describes the change with transaction-local
-- settings (set by the repository): app.price_source = SELLER | IMPORT | ADMIN, app.actor_id = uuid.
CREATE FUNCTION record_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source text := coalesce(nullif(current_setting('app.price_source', true), ''), 'SELLER');
  actor text := nullif(current_setting('app.actor_id', true), '');
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.original_price = OLD.original_price
     AND NEW.sale_price = OLD.sale_price THEN
    RETURN NEW;
  END IF;
  INSERT INTO price_history (variant_id, original_price, sale_price, source, changed_by)
  VALUES (NEW.id, NEW.original_price, NEW.sale_price, source::price_change_source, actor::uuid);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_variants_price_history
  AFTER INSERT OR UPDATE OF original_price, sale_price ON product_variants
  FOR EACH ROW EXECUTE FUNCTION record_price_history();

import { notFound } from "next/navigation";
import Lab from "@/components/Lab";
import { getProduct, latestAlmResult, latestFullResult, listSimulations } from "@/db/repo";

export const dynamic = "force-dynamic";

export default async function ProductLabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(Number(id));
  if (!product) notFound();
  const [initial, history, almLatest] = await Promise.all([
    latestFullResult(product.id),
    listSimulations(product.id),
    product.config.kind === "points_loan" ? latestAlmResult(product.id) : Promise.resolve(null),
  ]);
  return <Lab key={product.id} productId={product.id} config={product.config} initial={initial} history={history} almLatest={almLatest} />;
}

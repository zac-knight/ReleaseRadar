# Machine learning & data science in Release Radar

Everything here runs **in the browser** (no backend, no ML API key). The maths is implemented from scratch in
[`js/vec.js`](../js/vec.js) and [`js/ml.js`](../js/ml.js): pure functions, seeded randomness, unit-tested
([`test/vec.test.js`](../test/vec.test.js), [`test/ml.test.js`](../test/ml.test.js)).

## 1. Representing a film

Each title becomes one text: `title. genres. tagline. overview`. Two interchangeable engines embed it
([`js/semantic.js`](../js/semantic.js)):

| Engine | How | When |
|---|---|---|
| **MiniLM-L6-v2** (neural) | 384-d sentence embedding, mean pooling, L2-normalised, run with Transformers.js on WebAssembly | default |
| **Hashed TF-IDF** (fallback) | tokenise, drop stop-words, sublinear tf × idf, signed feature hashing into 512-d, L2-normalised | offline, blocked CDN, no WASM, or `?noml` |

Vectors are unit length, so cosine similarity is a dot product. The UI always states which engine produced a result.

## 2. Semantic search and “find similar”

Rank candidates by cosine similarity to the query vector (or to another title’s vector).

**Calibration.** Raw cosine scores are mapped to a match percentage on an *absolute* scale per engine
(`CALIBRATION` in `js/vec.js`), and anything below the engine’s relevance floor is dropped. An earlier version rescaled
scores within each result list, which made the worst result look like a 40% match; the fix and its test
(`calibrate never shows weak similarity as a match`) are in the history.

## 3. Taste model (supervised)

Saved titles are positives, the rest of the current selection are negatives. A logistic regression with L2 regularisation
and class weighting is trained by batch gradient descent on the embeddings (`trainLogReg`).

**Evaluation: leave-one-positive-out AUC.** For each saved title: retrain without it, then compute the probability that
it outranks a random unsaved title. The mean is reported in the UI (0.5 = guessing, 1.0 = perfect).

## 4. Taste map (unsupervised)

1. **PCA** to 2-D by power iteration with deflation (`pca2`).
2. **k-means++** seeding and Lloyd iterations (`kmeans`).
3. **k selection** by mean silhouette over k = 3…8 (`silhouette`).
4. **Cluster labels** from the most distinctive words per cluster (c-TF-IDF style score, `clusterTerms`) plus the cluster’s most common genre.

## 5. Evaluating the embeddings

There is no ground-truth “similar films” label, so genres act as **weak labels** the embedding never saw:

> For each title, what fraction of its 5 nearest neighbours share at least one genre? Compare with the expected fraction
> for neighbours chosen at random.

(`neighbourGenreHit`). The Insights view shows both numbers, so “better than chance” is measured, not asserted.

## 6. Descriptive analytics

Median/IQR/percentiles, histograms, month and weekday release density, genre frequency and a genre co-occurrence matrix
(`quantile`, `histogram`, `cooccurrence`), drawn as dependency-free SVG.

## Limitations (honest)

- Genres are weak labels; hit-rate@5 is a sanity check, not a human-judged relevance metric.
- The taste model has very little data (the titles you saved) and is evaluated with leave-one-out, which is noisy at small n.
- Clusters depend on the current filters; k-means is sensitive to initialisation (seeded here for reproducibility).
- Synopses are short and sometimes generic, which caps what any text embedding can do.
- The calibration thresholds are first estimates and have not yet been tuned against human relevance judgements.

## Ideas for next steps

- Train a model for **cinema-to-streaming window** (studio, genre, runtime, popularity → days to digital) with a held-out MAE against a naive baseline.
- Explain each recommendation (“because you saved X”) with nearest-saved-title attribution.
- Hybrid ranking (embedding similarity + collaborative signals) once there is more than one user.
- RAG over the catalogue with citations, with a retrieval evaluation set (recall@k).

import ts from "typescript";

const restrictedDomProperties = new Set([
  "document",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "getElementsByTagNameNS",
  "getElementsByName",
  "createElementNS",
  "createTextNode",
  "createDocumentFragment",
  "innerHTML",
  "outerHTML",
  "innerText",
  "textContent",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "insertAdjacentText",
  "appendChild",
  "removeChild",
  "replaceChild",
  "replaceChildren",
  "insertBefore",
  "setAttribute",
  "removeAttribute",
  "toggleAttribute",
  "classList",
]);

// Resolve browser members through TypeScript instead of banning names on every object.
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      dom: "Use React state, JSX, and refs instead of querying or manually modifying the DOM.",
      dynamic: "This computed DOM key may access a restricted property. Use a statically known, permitted property name.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error("no-direct-dom requires TypeScript project information.");
    }
    const checker = services.program.getTypeChecker();
    const fromDom = (symbol) => symbol?.declarations?.some((declaration) =>
      /[/\\]typescript[/\\]lib[/\\]lib\.dom(?:\.iterable)?\.d\.ts$/.test(declaration.getSourceFile().fileName));
    function check(node, receiver, names) {
      // Unknown string keys must not silently bypass restrictions on DOM receivers.
      const candidates = names === null ? [...restrictedDomProperties] : names.filter((name) => restrictedDomProperties.has(name));
      if (!candidates.length) return;
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(receiver));
      const types = type.isUnionOrIntersection() ? type.types : [type];
      if (types.some((part) => candidates.some((name) => fromDom(checker.getPropertyOfType(checker.getNonNullableType(part), name))))) {
        context.report({ node, messageId: names === null ? "dynamic" : "dom" });
      }
    }
    function concatenate(left, right) {
      // Bound expansion for union-valued expressions. Unknown keys fail closed.
      if (left === null || right === null || left.length * right.length > 64) return null;
      return [...new Set(left.flatMap((a) => right.map((b) => a + b)))];
    }
    function propertyNames(node, computed = true) {
      if (!computed && node.type === "Identifier") return [node.name];
      if (node.type === "Literal") return [String(node.value)];
      if (node.type === "BinaryExpression" && node.operator === "+") {
        return concatenate(propertyNames(node.left), propertyNames(node.right));
      }
      if (node.type === "TemplateLiteral") {
        let names = [node.quasis[0].value.cooked];
        for (let i = 0; i < node.expressions.length; i++) {
          names = concatenate(concatenate(names, propertyNames(node.expressions[i])), [node.quasis[i + 1].value.cooked]);
        }
        return names;
      }
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
      const types = type.isUnion() ? type.types : [type];
      if (types.every((part) => part.flags & ts.TypeFlags.StringLiteral)) return types.map((part) => part.value);
      // Numeric and symbol keys cannot name any of the restricted string members.
      if (types.every((part) => part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.ESSymbolLike))) return [];
      return null;
    }
    return {
      MemberExpression(node) {
        check(node, node.object, propertyNames(node.property, node.computed));
      },
      // Destructuring must not bypass the restriction.
      Property(node) {
        if (node.parent.type === "ObjectPattern") {
          check(node, node.parent, propertyNames(node.key, node.computed));
        }
      },
    };
  },
};
